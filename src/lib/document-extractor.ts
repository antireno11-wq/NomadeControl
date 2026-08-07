import { openaiChatCompletion } from "./openai";
import { extraerTextoPdf, tieneTextoUtil } from "./pdf-text";
import { esDocLegacy, esDocx, extraerTextoDocx } from "./docx-text";

/** Tipo del catálogo, tal como lo espera el extractor. */
export type TipoParaExtraccion = {
  id: string;
  codigo: string;
  nombre: string;
  /** Documento de constancia: no lleva fecha de vencimiento. */
  noVence?: boolean;
};

/** Un documento detectado dentro de un archivo. */
export type ExtractedDoc = {
  /** Código del catálogo, o "unknown" si no pudo clasificarlo. */
  detectedCodigo: string;
  detectedTipoId: string | null;
  detectedDocTypeLabel: string;
  expiryDate: string | null;         // YYYY-MM-DD o null
  issueDate: string | null;          // YYYY-MM-DD o null
  workerName: string | null;
  workerRut: string | null;
  /**
   * Documento colectivo: un solo papel firmado por varias personas —una
   * declaración jurada, un acta de entrega de EPP grupal, la lista de
   * asistencia de un curso. Vale para todos los que firman, así que el mismo
   * archivo se registra en la ficha de cada uno.
   */
  titulares: Array<{ nombre: string | null; rut: string | null }> | null;
  /**
   * El documento dice EXPLÍCITAMENTE que no caduca —un contrato o anexo de
   * duración indefinida—. Es distinto de no haberle encontrado la fecha: uno
   * se guarda tranquilo, el otro hay que revisarlo.
   */
  sinVencimiento: boolean;
  /** Página donde empieza, en PDFs con varios documentos. */
  paginaInicio: number | null;
  confidence: "high" | "medium" | "low";
  reasoning: string;
};

const MIME_PDF = "application/pdf";

function buildSystemPrompt(tipos: TipoParaExtraccion[]) {
  const lista = tipos
    .map(t => `- ${t.codigo}: ${t.nombre}${t.noVence ? "  [NO VENCE — es una constancia]" : ""}`)
    .join("\n");
  return `Eres un asistente experto en documentos laborales chilenos. Extraes información estructurada de documentos que RRHH sube para el control documental de sus trabajadores.

IMPORTANTE: un archivo puede contener VARIOS documentos distintos concatenados (las carpetas de acreditación suelen ser un PDF con contrato, cédula, exámenes y certificados uno detrás de otro). Tienes que identificarlos TODOS y devolver uno por cada uno.

Tipos de documento posibles:
${lista}

Reglas:
- Devuelve SIEMPRE JSON válido con la estructura pedida.
- Fechas SIEMPRE en formato YYYY-MM-DD. Si el documento muestra 15/06/2027, devuelve "2027-06-15".
- Si NO puedes leer una fecha, devuelve null. NO la inventes ni la estimes.
- Elige el código EXACTO de la lista de arriba, o "unknown" si no coincide con ninguno.
- CRÍTICO — NO CONFUNDAS EMISIÓN CON VENCIMIENTO. Es el error más grave posible: pone como "vencido" un documento que está vigente.
  · Van en issueDate (fecha de emisión/realización): "realizado con fecha", "de fecha", "efectuado el", "emitido el", "Santiago, a <fecha>", "fecha de examen", "fecha de la muestra", "fecha de aprobación", "fecha del curso", la fecha junto a una firma.
  · Van en expiryDate SOLO si el texto lo dice explícitamente: "vence el", "válido hasta", "vigente hasta", "fecha de vencimiento", "FECHA EXPIRACIÓN", "expira el", "caduca el", "válido por ... hasta".
  · Si el documento tiene UNA SOLA fecha y no dice explícitamente que sea de vencimiento, va en issueDate y expiryDate queda null. NO asumas que la única fecha es el vencimiento.
  · Ejemplo: "El examen de detección de consumo de drogas realizado con fecha 15/07/2026..." → issueDate "2026-07-15", expiryDate null. Esa fecha es cuándo se hizo el examen, NO cuándo caduca.
- LICENCIA DE CONDUCIR CHILENA. Trae dos fechas con nombres casi iguales y es fácil confundirlas:
  · "FECHA ÚLTIMO CONTROL" es cuándo se emitió o renovó → issueDate.
  · "FECHA DE CONTROL" es el PRÓXIMO control, o sea hasta cuándo vale → expiryDate.
  Ejemplo real: "FECHA ÚLTIMO CONTROL 15/05/2020 · FECHA DE CONTROL 23/03/2027" → issueDate "2020-05-15", expiryDate "2027-03-23". Tomar la primera como vencimiento marca vencida una licencia vigente.
- ALTURA GEOGRÁFICA vs ALTURA FÍSICA. Son dos exámenes distintos que suelen venir en el mismo PDF, uno detrás del otro, y confundirlos deja al trabajador con uno de los dos marcado como faltante:
  · ALTURA GEOGRÁFICA (gran altitud): aptitud para trabajar sobre los 3.000 m s.n.m. Habla de "altitud", "m.s.n.m.", "gran altitud", "hipobaria", "hipobárica", "intermitente".
  · ALTURA FÍSICA: aptitud para trabajos en altura sobre el nivel del piso —andamios, techos, plataformas—. Habla de "trabajo en altura", "andamio", "vértigo", "equilibrio", "altura física".
  Lee el título de CADA informe antes de asignarlo; no supongas el orden ni te guíes por el nombre del archivo, que suele mencionar solo uno de los dos.
- LOS NÚMEROS NO SON FECHAS. Los documentos están llenos de números largos que NO hay que interpretar como fechas: el número de la licencia, el RUT, "Nro. Carpeta", el folio, el código de barras del reverso, los códigos de verificación de los diplomas. Si un número no viene rotulado como fecha ni tiene separadores de fecha, ignóralo. Una fecha inventada a partir de un folio es peor que no tener fecha, porque nadie la va a cuestionar.
- UN VENCIMIENTO NUNCA ES ANTERIOR A LA EMISIÓN. Si de dos fechas una es claramente posterior, esa es la de vencimiento y la anterior es la de emisión.
- CONTRATO O ANEXO INDEFINIDO. Si el documento dice "indefinido", "de duración indefinida", "plazo indefinido" o convierte el contrato a indefinido, NO tiene fecha de vencimiento: pon expiryDate en null y sinVencimiento en true. Es distinto de no haberle encontrado la fecha — acá el documento sí dice que no caduca, y no hay nada que revisar.
- sinVencimiento es true SOLO cuando el documento lo dice. Si simplemente no encontraste el vencimiento, déjalo en false y expiryDate en null.
- Hay tipos marcados [NO VENCE]: son constancias (actas de entrega, recepciones, declaraciones juradas). NO tienen vencimiento. Para esos pon expiryDate en null, issueDate con la fecha del acta, y confidence "high" si identificaste bien el tipo. NO bajes la confianza por no encontrar un vencimiento que el documento no tiene.
- Si un documento que normalmente sí vence no trae la fecha impresa (ej. contrato indefinido), pon expiryDate en null y explícalo en reasoning.
- Los certificados de capacitación y los exámenes suelen traer solo la fecha de realización: esa va en issueDate y expiryDate queda null.
  Pero algunos SÍ traen las dos, y hay que separarlas bien. Ejemplo real de un diploma de Mutual:
  "REALIZADO: 16 DE JULIO DE 2026 - DURACIÓN: 6 HORAS ... FECHA EXPIRACIÓN: 16/07/2029"
  → issueDate "2026-07-16", expiryDate "2029-07-16".
- workerName: NORMALIZADO, no copiado literal. Tres cosas:
  1. ORDEN NATURAL. Los documentos chilenos suelen escribir "APELLIDO_PATERNO APELLIDO_MATERNO NOMBRES" o usan campos separados. Devuélvelo siempre como se llama la persona: nombres primero, después apellidos.
     · "SOTO OYARZUN JESUS IGNACIO"  → "Jesús Ignacio Soto Oyarzún"
     · "GARRIDO ACEVEDO ALVARO"      → "Álvaro Garrido Acevedo"
     · Si no distingues cuáles son nombres y cuáles apellidos, déjalo como está y bájale la confianza.
  2. MAYÚSCULAS Y TILDES. Pásalo a formato título con los acentos que corresponden en español: "JESUS" → "Jesús", "OYARZUN" → "Oyarzún", "MUNOZ" → "Muñoz".
  3. NO INVENTES NI CORRIJAS. Si una letra se lee rara o el texto está borroso, transcríbelo tal como lo ves y pon confidence "low". Es preferible que el humano corrija un nombre mal leído a que tú adivines uno equivocado que parezca correcto.
- workerRut: formato chileno, ej. "12.345.678-9".
- paginaInicio: número de página (empezando en 1) donde arranca el documento. Si es un archivo de una sola página o una foto, pon 1.
- confidence por documento:
  - "high" = identificaste bien el tipo y las fechas que hay están claras (incluye el caso de un documento sin vencimiento)
  - "medium" = alguna ambigüedad: borroso, formato raro, o dudas sobre si una fecha es emisión o vencimiento
  - "low" = imagen mala, campos no visibles, dudas sobre el tipo, o el nombre se lee dudoso
- reasoning: 1-2 frases sobre en qué te basaste.
- UN DOCUMENTO PUEDE OCUPAR VARIAS HOJAS O VARIAS CARAS. Devuélvelo UNA sola vez, nunca uno por hoja.
  · Cédula de identidad: la cara delantera (foto, nombres, RUN) y la trasera (huella, número de documento, código de barras) son EL MISMO documento. Una sola entrada.
  · Licencia de conducir: igual, anverso y reverso son un solo documento.
  · Ficha de ingreso, contratos, finiquitos, exámenes: todas sus hojas son un solo documento. Que la hoja 2 tenga otro encabezado no la convierte en otro documento.
  · Si el archivo trae el mismo documento repetido (dos copias de la cédula), devuélvelo UNA sola vez.
  · Solo devuelve entradas separadas cuando son documentos DISTINTOS de verdad: un contrato Y una cédula Y un examen.
- CRÍTICO — DE QUIÉN ES EL DOCUMENTO. workerName es SIEMPRE el titular del documento, nunca otra persona nombrada adentro. Este es el segundo error más grave: le carga los documentos a la persona equivocada.
  · Ficha de ingreso: el titular está en "Nombres" + "Apellidos" arriba de todo. La sección "EN CASO DE EMERGENCIA AVISAR A" nombra a un familiar — ESE NO ES EL TRABAJADOR. Si la hoja que estás leyendo SOLO tiene el contacto de emergencia y no el titular, devuelve workerName null; no uses el nombre del contacto.
  · Finiquito: el titular es el "Ex Trabajador(a)". NO el empleador, ni su representante legal, ni el notario, ni quien firma como apoderado.
  · Contrato: el titular es el trabajador, no el representante de la empresa.
  · Certificados y diplomas: el titular es a quien se le extiende, no el relator ni quien firma.
  · Exámenes de mutualidad (ACHS, Mutual, IST): el texto suele empezar con el RUT y el nombre del PROFESIONAL que lo firma —"EU JOUSTRA ZUÑIGA KAREN", "Dr.", "matrona", "técnico paramédico"— y recién después aparece el trabajador. Ese primer nombre NO es el titular. El titular es la persona a la que se le practicó el examen.
  · Si el documento nombra a un profesional, un ministro de fe o un representante, y no distingues cuál es el trabajador, devuelve null. Un documento sin asignar se arregla en un clic; uno asignado a la persona equivocada crea una ficha falsa que nadie va a notar.
  · Ante la duda entre dos nombres, devuelve el que aparezca junto al RUT del titular, y baja la confianza.
  · Si en la hoja no aparece ningún nombre de titular, devuelve null. Es preferible que quede sin asignar a que quede asignado a la persona equivocada.
- DOCUMENTOS COLECTIVOS. Algunos documentos son UNO SOLO firmado por VARIAS personas: declaraciones juradas por competencias, actas de entrega de EPP grupales, listas de asistencia o registros de inducción con una fila por trabajador, nóminas firmadas.
  · Reconócelos porque traen una TABLA o LISTA de nombres con sus RUT y firmas, no un solo titular.
  · En esos casos devuelve UNA sola entrada de documento, con "titulares" como lista de TODOS los que firman, y workerName/workerRut en null.
  · DEVUELVE A TODOS LOS FIRMANTES, no solo a los primeros. Recorre la tabla fila por fila hasta el final, incluidas las páginas siguientes si la lista continúa. Si hay doce filas con nombre, "titulares" tiene doce entradas. Dejar fuera a alguien es peor que no detectar el documento: esa persona queda sin la constancia y nadie se entera, porque el documento sí aparece cargado para los demás.
  · Cuenta las filas antes de responder y verifica que la cantidad de "titulares" coincida.
  · NO devuelvas un documento por firmante: es un solo papel. La app lo va a registrar en la ficha de cada persona apuntando al mismo archivo.
  · Si el documento tiene un titular claro y además menciona a otros (el jefe que entrega, el relator, un testigo), NO es colectivo: usa workerName con el titular y deja "titulares" en null.
- EL NOMBRE DEL ARCHIVO ES UNA PISTA VÁLIDA. Las carpetas de acreditación se nombran por su contenido: "Curso Manipulación SUSPEL.pdf", "04 Examen Altura Geografica - Juan Perez.pdf", "3.- IRL MANTENCION.pdf". Úsalo para clasificar el tipo y, si trae el nombre de la persona, para workerName.
- NUNCA devuelvas una lista vacía si recibiste un archivo. Algunos documentos vienen como plantillas sin rellenar (diplomas con los campos en blanco) o son escaneos ilegibles: en esos casos igual devuelve UNA entrada con lo que puedas deducir del nombre del archivo, el resto en null y confidence "low", explicando en reasoning qué pasó ("el diploma está en blanco", "el escaneo es ilegible"). Perder el archivo en silencio es peor que devolverlo incompleto para que un humano lo complete.
- Solo devuelve {"documentos": []} si literalmente no recibiste ningún archivo.

Formato JSON exacto:
{
  "documentos": [
    {
      "detectedCodigo": "<codigo de la lista, o unknown>",
      "expiryDate": "<YYYY-MM-DD o null>",
      "issueDate": "<YYYY-MM-DD o null>",
      "workerName": "<nombre o null>",
      "workerRut": "<rut o null>",
      "sinVencimiento": false,
      "titulares": null,
      "//titulares": "solo en documentos colectivos: [{\"nombre\": \"...\", \"rut\": \"...\"}, ...]",
      "paginaInicio": <número>,
      "confidence": "high|medium|low",
      "reasoning": "<breve>"
    }
  ]
}`;
}

/**
 * Analiza un archivo (imagen o PDF) y devuelve TODOS los documentos que
 * encuentra dentro.
 *
 * Los PDFs se mandan directo a OpenAI, que extrae el texto y renderiza las
 * páginas — no hace falta convertirlos a imagen antes.
 *
 * El resultado NUNCA se escribe sin confirmación humana: una fecha mal
 * leída marcaría como vigente algo que no lo está, y eso es peor que no
 * tener sistema.
 */
export async function extractDocumentInfo(input: {
  fileBase64: string;
  mimeType: string;
  fileName: string;
  tipos: TipoParaExtraccion[];
  model?: string;
}): Promise<ExtractedDoc[]> {
  const esPdf = input.mimeType === MIME_PDF;
  const dataUrl = `data:${input.mimeType};base64,${input.fileBase64}`;

  // ── Word ────────────────────────────────────────────────────────────
  // El .docx no viaja como adjunto ni como imagen: se abre acá y se manda
  // el texto. Un IRL o una declaración jurada llegan casi siempre en Word.
  if (esDocx(input.mimeType, input.fileName)) {
    const texto = extraerTextoDocx(Buffer.from(input.fileBase64, "base64"));
    if (!texto.trim()) {
      throw new Error(
        `No se pudo leer el contenido de «${input.fileName}». Si es un .doc antiguo, ` +
        `guárdalo como .docx o expórtalo a PDF y vuelve a subirlo.`,
      );
    }
    return await pedirExtraccion(input, [
      {
        type: "text" as const,
        text:
          `Analiza este documento de Word (${input.fileName}). Este es su texto completo, ` +
          `fiel al original. Puede contener varios documentos: identifícalos todos.\n\n` +
          `--- TEXTO DEL DOCUMENTO ---\n${texto}\n--- FIN DEL TEXTO ---\n\nDevuelve el JSON.`,
      },
    ], 4000);
  }

  if (esDocLegacy(input.mimeType, input.fileName)) {
    throw new Error(
      `«${input.fileName}» está en el formato .doc antiguo, que no se puede leer. ` +
      `Ábrelo en Word y guárdalo como .docx o como PDF.`,
    );
  }

  // La capa de texto del PDF se extrae acá y se manda explícita. Depender
  // solo del procesamiento del adjunto resultó poco fiable: certificados
  // con todo su contenido volvían como "no se reconoció ningún documento".
  // Los escaneos puros no tienen texto y siguen resolviéndose por visión.
  let textoPdf = "";
  if (esPdf) {
    try {
      const extraido = extraerTextoPdf(Buffer.from(input.fileBase64, "base64"));
      if (tieneTextoUtil(extraido)) textoPdf = extraido;
    } catch {
      /* si falla la extracción, queda el adjunto */
    }
  }

  const contenido = esPdf
    ? [
        { type: "file" as const, file: { filename: input.fileName, file_data: dataUrl } },
        {
          type: "text" as const,
          text: textoPdf
            ? `Analiza este PDF (${input.fileName}). Puede tener varios documentos adentro: identifícalos todos.\n\n` +
              `Este es el texto extraído del PDF. Es fiel al original — úsalo como fuente principal, ` +
              `y las imágenes de las páginas solo para lo que el texto no cubra (sellos, firmas, tablas).\n` +
              `Puede venir fragmentado por cómo el PDF guarda el texto; reconstruye las frases.\n\n` +
              `--- TEXTO DEL PDF ---\n${textoPdf}\n--- FIN DEL TEXTO ---\n\nDevuelve el JSON.`
            : `Analiza este PDF (${input.fileName}). No tiene capa de texto (es un escaneo), así que ` +
              `léelo de las imágenes de las páginas. Puede tener varios documentos adentro: ` +
              `identifícalos todos y devuelve el JSON.`,
        },
      ]
    : [
        { type: "text" as const, text: `Analiza este documento (${input.fileName}) y devuelve el JSON.` },
        { type: "image_url" as const, image_url: { url: dataUrl, detail: "high" as const } },
      ];

  // Un PDF consolidado puede traer 15+ documentos; una foto suelta, uno.
  return await pedirExtraccion(input, contenido, esPdf ? 4000 : 900);
}

/** Manda el contenido ya armado a OpenAI y normaliza la respuesta. */
async function pedirExtraccion(
  input: { tipos: TipoParaExtraccion[]; model?: string },
  contenido: unknown[],
  maxTokens: number,
): Promise<ExtractedDoc[]> {
  const response = await openaiChatCompletion({
    model: input.model ?? "gpt-4o-mini",
    responseFormat: "json_object",
    messages: [
      { role: "system", content: buildSystemPrompt(input.tipos) },
      { role: "user", content: contenido as never },
    ],
    temperature: 0,
    maxTokens,
  });

  const raw = response.choices[0]?.message.content ?? "";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Respuesta de OpenAI no es JSON válido: ${raw.slice(0, 200)}`);
  }

  const lista = Array.isArray(parsed.documentos) ? parsed.documentos : [];

  return (lista as Array<Record<string, unknown>>).map(d => {
    const codigo = cleanString(d.detectedCodigo) ?? "unknown";
    const tipo = input.tipos.find(t => t.codigo === codigo) ?? null;
    const pagina = typeof d.paginaInicio === "number" ? d.paginaInicio : null;

    const emision = normalizeDate(d.issueDate);
    let vencimiento = normalizeDate(d.expiryDate);
    let notaFechas = "";

    // Un vencimiento anterior a la emisión es imposible: el modelo cambió las
    // fechas de lugar. Pasó con la licencia de conducir, que rotula "fecha
    // último control" a la emisión y "fecha de control" al vencimiento. Se
    // corrige acá porque una regla del prompt puede fallar y esto no.
    if (emision && vencimiento && vencimiento < emision) {
      [vencimiento, notaFechas] = [emision, ` · Las fechas venían invertidas (vencimiento ${vencimiento} anterior a la emisión); se intercambiaron.`];
      return {
        detectedCodigo: tipo?.codigo ?? "unknown",
        detectedTipoId: tipo?.id ?? null,
        detectedDocTypeLabel: tipo?.nombre ?? "Desconocido",
        expiryDate: vencimiento,
        issueDate: normalizeDate(d.expiryDate),
        workerName: cleanString(d.workerName),
        workerRut: normalizeRut(d.workerRut),
        titulares: null,
        sinVencimiento: d.sinVencimiento === true,
        paginaInicio: pagina && pagina > 0 ? pagina : null,
        confidence: "medium" as const,
        reasoning: `${cleanString(d.reasoning) ?? ""}${notaFechas}`.trim(),
      };
    }

    return {
      detectedCodigo: tipo?.codigo ?? "unknown",
      detectedTipoId: tipo?.id ?? null,
      detectedDocTypeLabel: tipo?.nombre ?? "Desconocido",
      expiryDate: normalizeDate(d.expiryDate),
      issueDate: normalizeDate(d.issueDate),
      workerName: cleanString(d.workerName),
      workerRut: normalizeRut(d.workerRut),
      sinVencimiento: d.sinVencimiento === true,
      titulares: Array.isArray(d.titulares) && d.titulares.length > 1
        ? (d.titulares as Array<Record<string, unknown>>)
            .map(t => ({ nombre: cleanString(t.nombre), rut: normalizeRut(t.rut) }))
            .filter(t => t.nombre || t.rut)
        : null,
      paginaInicio: pagina && pagina > 0 ? pagina : null,
      confidence: (d.confidence as "high" | "medium" | "low") ?? "low",
      reasoning: cleanString(d.reasoning) ?? "",
    };
  });
}

/**
 * Los modelos devuelven a veces un marcador de "no lo sé" en vez de null:
 * "unknown", "desconocido", "N/A", "no aplica". Si se dejan pasar, ese texto
 * termina cargado como si fuera el RUT de la persona — y peor, dos lecturas
 * del mismo trabajador con "unknown" y con su RUT real quedan como personas
 * distintas, porque la agrupación los ve como dos RUT que no coinciden.
 */
const MARCADORES_VACIO = new Set([
  "null", "undefined", "unknown", "desconocido", "desconocida", "n/a", "na",
  "no aplica", "no disponible", "sin informacion", "sin información",
  "sin datos", "no indica", "no especificado", "-", "--", "?",
]);

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return MARCADORES_VACIO.has(s.toLowerCase()) ? null : s;
}

/**
 * Valida que sea una fecha de verdad y no un número disfrazado.
 *
 * El formato por sí solo no alcanza: "2038-11-69" cumple el patrón y no
 * existe. Salió del código de barras de una licencia de conducir —el modelo
 * tomó "20381169" por una fecha—, y una fecha inventada a partir de un folio
 * es peor que no tener fecha, porque nadie la va a cuestionar.
 */
function normalizeDate(v: unknown): string | null {
  const s = cleanString(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;

  const [y, m, d] = s.split("-").map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  // Si el día no sobrevive el ida y vuelta, no era una fecha (31 de febrero).
  if (fecha.getUTCFullYear() !== y || fecha.getUTCMonth() !== m - 1 || fecha.getUTCDate() !== d) {
    return null;
  }

  // Ventana plausible para un documento laboral. Fuera de acá casi siempre
  // es un número de folio, de carpeta o de código de barras mal leído.
  const anioActual = new Date().getUTCFullYear();
  if (y < 1950 || y > anioActual + 30) return null;

  return s;
}

function normalizeRut(v: unknown): string | null {
  const s = cleanString(v);
  if (!s) return null;
  return /^\d{1,2}\.?\d{3}\.?\d{3}-?[0-9kK]$/.test(s) ? s : s;
}

/**
 * Empareja el nombre/RUT extraído con los trabajadores del sistema.
 * Devuelve los mejores candidatos ordenados por score.
 */
export function matchWorker(
  extracted: { name: string | null; rut: string | null },
  workers: Array<{ id: string; fullName: string; nationalId: string | null }>,
): Array<{ workerId: string; score: number; reason: string }> {
  if (workers.length === 0) return [];

  // RUT exacto gana sobre cualquier similitud de nombre
  if (extracted.rut) {
    const rutClean = extracted.rut.replace(/[.\-\s]/g, "").toUpperCase();
    for (const w of workers) {
      const wRut = (w.nationalId ?? "").replace(/[.\-\s]/g, "").toUpperCase();
      if (wRut && wRut === rutClean) {
        return [{ workerId: w.id, score: 100, reason: "RUT exacto" }];
      }
    }
  }

  if (!extracted.name) return [];

  const normName = (s: string) =>
    s.toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);

  const extractedTokens = normName(extracted.name);
  if (extractedTokens.length === 0) return [];

  return workers
    .map(w => {
      const workerTokens = normName(w.fullName);
      const common = extractedTokens.filter(t => workerTokens.includes(t)).length;
      const score = Math.round((common / Math.max(extractedTokens.length, workerTokens.length)) * 100);
      return { workerId: w.id, score, reason: `${common} palabra${common !== 1 ? "s" : ""} en común` };
    })
    .filter(c => c.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
