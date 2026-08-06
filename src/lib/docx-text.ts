import zlib from "zlib";

/**
 * Extrae el texto de un .docx sin dependencias externas.
 *
 * Un .docx es un ZIP: adentro, `word/document.xml` tiene el contenido. Ni
 * OpenAI ni el navegador lo leen como adjunto, así que si no lo abrimos acá
 * el archivo se pierde. Mismo criterio que `pdf-text.ts`: es preferible
 * mandar el texto plano y que el modelo trabaje sobre eso, a descartar el
 * documento en silencio.
 *
 * El .doc antiguo (binario de Word 97) no se soporta: es otro formato
 * completo. `extraerTextoDocx` devuelve "" y la UI lo dice explícitamente.
 */

export const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MIME_DOC = "application/msword";

/** Lee una entrada del ZIP a partir del offset de su cabecera local. */
function leerEntrada(buf: Buffer, offsetLocal: number, comprimido: number, metodo: number): Buffer | null {
  if (offsetLocal + 30 > buf.length) return null;
  if (buf.readUInt32LE(offsetLocal) !== 0x04034b50) return null;

  const lenNombre = buf.readUInt16LE(offsetLocal + 26);
  const lenExtra = buf.readUInt16LE(offsetLocal + 28);
  const inicio = offsetLocal + 30 + lenNombre + lenExtra;
  const datos = buf.subarray(inicio, inicio + comprimido);

  if (metodo === 0) return datos;          // almacenado sin comprimir
  if (metodo !== 8) return null;           // solo deflate
  try {
    return zlib.inflateRawSync(datos);
  } catch {
    return null;
  }
}

/** Busca `word/document.xml` recorriendo el directorio central del ZIP. */
function extraerDocumentXml(buf: Buffer): Buffer | null {
  // El directorio central se recorre de atrás hacia adelante desde el EOCD,
  // pero basta con escanear sus firmas: son inequívocas dentro del ZIP.
  const SIG = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let pos = buf.indexOf(SIG);

  while (pos >= 0 && pos + 46 <= buf.length) {
    const metodo = buf.readUInt16LE(pos + 10);
    const comprimido = buf.readUInt32LE(pos + 20);
    const lenNombre = buf.readUInt16LE(pos + 28);
    const lenExtra = buf.readUInt16LE(pos + 30);
    const lenComentario = buf.readUInt16LE(pos + 32);
    const offsetLocal = buf.readUInt32LE(pos + 42);
    const nombre = buf.subarray(pos + 46, pos + 46 + lenNombre).toString("latin1");

    if (nombre === "word/document.xml") {
      return leerEntrada(buf, offsetLocal, comprimido, metodo);
    }
    pos = buf.indexOf(SIG, pos + 46 + lenNombre + lenExtra + lenComentario);
  }
  return null;
}

const ENTIDADES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'",
};

function limpiarXml(xml: string): string {
  return xml
    // La estructura importa: un párrafo por línea y las celdas separadas.
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&\w+;/g, e => ENTIDADES[e] ?? e)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Texto del .docx, o "" si el archivo no es un .docx legible. */
export function extraerTextoDocx(buffer: Buffer, maxChars = 20_000): string {
  // Firma de ZIP. Un .doc binario empieza con D0 CF 11 E0 y cae acá.
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) return "";

  const xml = extraerDocumentXml(buffer);
  if (!xml) return "";

  const texto = limpiarXml(xml.toString("utf8"));
  return texto.length > maxChars ? texto.slice(0, maxChars) + "\n[…texto truncado…]" : texto;
}

/** ¿Es un formato de Word que sabemos abrir? */
export function esDocx(mimeType: string, fileName: string): boolean {
  return mimeType === MIME_DOCX || /\.docx$/i.test(fileName);
}

/** .doc antiguo: lo reconocemos para poder explicar por qué no se puede leer. */
export function esDocLegacy(mimeType: string, fileName: string): boolean {
  return mimeType === MIME_DOC || (/\.doc$/i.test(fileName) && !/\.docx$/i.test(fileName));
}
