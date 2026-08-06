import zlib from "zlib";

/**
 * Extrae la capa de texto de un PDF sin dependencias externas.
 *
 * Por qué existe: mandarle el PDF a OpenAI y confiar en que lo procese
 * resultó poco fiable — un diploma de Mutual con todo su contenido
 * (nombre, curso, fechas) volvía como "no se reconoció ningún documento".
 * Extrayendo el texto acá y mandándolo junto al archivo, el modelo recibe
 * el contenido aunque el procesamiento del adjunto falle.
 *
 * Limitación: solo sirve para PDFs con capa de texto. Los escaneos puros
 * (imagen sin texto) devuelven vacío y siguen dependiendo de la visión
 * del modelo, que es lo correcto para esos.
 */

/** Descomprime un stream FlateDecode, tolerando basura al final. */
function inflar(raw: Buffer): Buffer | null {
  for (const candidato of [raw, raw.subarray(0, raw.length - 1), raw.subarray(0, raw.length - 2)]) {
    try {
      return zlib.inflateSync(candidato);
    } catch {
      /* probamos el siguiente recorte */
    }
  }
  return null;
}

/**
 * Muchos PDFs guardan el texto en UTF-16BE: cada carácter ocupa dos bytes y,
 * para el alfabeto latino, el primero es 0x00. Leído como latin1 eso deja un
 * NUL delante de cada letra — "WALTER" llega como "\0W\0A\0L\0T\0E\0R".
 *
 * Importa porque ese texto se le manda al modelo diciéndole que es fiel al
 * original: si va intercalado con NULs, la instrucción es falsa y el modelo
 * queda peor que sin texto.
 */
function decodificarUtf16BE(s: string): string {
  if (s.length < 4) return s;
  let nulsPares = 0;
  const pares = Math.floor(s.length / 2);
  for (let i = 0; i < pares; i++) if (s.charCodeAt(i * 2) === 0) nulsPares++;
  if (nulsPares / pares < 0.7) return s;

  let out = "";
  for (let i = 0; i + 1 < s.length; i += 2) {
    out += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1));
  }
  return out;
}

/** Resuelve los escapes de una cadena literal PDF: \( \) \\ \n y octales \053 */
function decodificarLiteral(s: string): string {
  return s
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\([()\\])/g, "$1");
}

/** Cadena hexadecimal <004100420043>, la otra forma de escribir texto en PDF. */
function decodificarHex(s: string): string {
  const limpio = s.replace(/[^0-9a-fA-F]/g, "");
  // Con marca UTF-16BE explícita o pares de 4 dígitos, se lee de a 2 bytes.
  const dos = limpio.length % 4 === 0 && /^(00[0-9a-fA-F]{2}){2,}$/.test(limpio);
  const paso = dos ? 4 : 2;
  let out = "";
  for (let i = 0; i + paso <= limpio.length; i += paso) {
    out += String.fromCharCode(parseInt(limpio.slice(i, i + paso), 16));
  }
  return out;
}

/**
 * Devuelve el texto del PDF, o cadena vacía si no tiene capa de texto.
 * `maxChars` corta documentos enormes para no inflar el prompt.
 */
export function extraerTextoPdf(buffer: Buffer, maxChars = 20_000): string {
  const bin = buffer.toString("latin1");
  const fragmentos: string[] = [];

  const reStream = /stream\r?\n/g;
  let m: RegExpExecArray | null;

  while ((m = reStream.exec(bin)) !== null) {
    const inicio = m.index + m[0].length;
    const fin = bin.indexOf("endstream", inicio);
    if (fin < 0) continue;

    const contenido = inflar(Buffer.from(bin.slice(inicio, fin), "latin1"));
    if (!contenido) continue;

    const texto = contenido.toString("latin1");

    // Operadores de texto: (cadena) Tj, <hex> Tj y [(a) -250 (b)] TJ
    const reTexto = /\[((?:[^\[\]\\]|\\.)*)\]\s*TJ|\((?:[^()\\]|\\.)*\)\s*Tj|<[0-9a-fA-F\s]+>\s*Tj/g;
    let t: RegExpExecArray | null;
    while ((t = reTexto.exec(texto)) !== null) {
      const partes = t[0].match(/\((?:[^()\\]|\\.)*\)|<[0-9a-fA-F\s]+>/g) ?? [];
      const linea = partes
        .map(pt => pt.startsWith("<")
          ? decodificarHex(pt.slice(1, -1))
          : decodificarUtf16BE(decodificarLiteral(pt.slice(1, -1))))
        .join("")
        .trim();
      if (linea) fragmentos.push(linea);
    }

    if (fragmentos.join(" ").length > maxChars) break;
  }

  // Los PDFs suelen partir una frase en varios operadores: unimos con
  // salto de línea para que el modelo vea la estructura, no un chorizo.
  const salida = fragmentos.join("\n").trim();
  return salida.length > maxChars ? salida.slice(0, maxChars) + "\n[…texto truncado…]" : salida;
}

/** ¿Vale la pena mandarle este texto al modelo? */
export function tieneTextoUtil(texto: string): boolean {
  const limpio = texto.replace(/\s+/g, " ").trim();
  // Menos de 20 caracteres o sin letras: probablemente ruido de un escaneo
  return limpio.length >= 20 && /[a-záéíóúñA-ZÁÉÍÓÚÑ]{3}/.test(limpio);
}
