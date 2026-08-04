import { openaiChatCompletion } from "./openai";

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
- Distinguí bien EMISIÓN de VENCIMIENTO. El que importa es el vencimiento (expiryDate); la emisión (issueDate) es informativa.
- Hay tipos marcados [NO VENCE]: son constancias (actas de entrega, recepciones, declaraciones juradas). NO tienen vencimiento. Para esos pon expiryDate en null, issueDate con la fecha del acta, y confidence "high" si identificaste bien el tipo. NO bajes la confianza por no encontrar un vencimiento que el documento no tiene.
- Si un documento que normalmente sí vence no trae la fecha impresa (ej. contrato indefinido), pon expiryDate en null y explícalo en reasoning.
- Los certificados de capacitación suelen traer solo la fecha de realización: esa va en issueDate.
- workerName: tal como aparece en el documento, con apellidos.
- workerRut: formato chileno, ej. "12.345.678-9".
- paginaInicio: número de página (empezando en 1) donde arranca el documento. Si es un archivo de una sola página o una foto, pon 1.
- confidence por documento:
  - "high" = vencimiento claramente visible y legible
  - "medium" = alguna ambigüedad (borroso, formato raro, falta contexto)
  - "low" = imagen mala, campos no visibles, o dudás del tipo
- reasoning: 1-2 frases sobre en qué te basaste.
- Si el archivo trae el mismo documento repetido (ej. dos copias de la cédula), devolvelo UNA sola vez.
- Si no reconoces ningún documento, devuelve {"documentos": []}.

Formato JSON exacto:
{
  "documentos": [
    {
      "detectedCodigo": "<codigo de la lista, o unknown>",
      "expiryDate": "<YYYY-MM-DD o null>",
      "issueDate": "<YYYY-MM-DD o null>",
      "workerName": "<nombre o null>",
      "workerRut": "<rut o null>",
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

  const contenido = esPdf
    ? [
        { type: "file" as const, file: { filename: input.fileName, file_data: dataUrl } },
        { type: "text" as const, text: `Analiza este PDF (${input.fileName}). Puede tener varios documentos adentro: identifícalos todos y devuelve el JSON.` },
      ]
    : [
        { type: "text" as const, text: `Analiza este documento (${input.fileName}) y devuelve el JSON.` },
        { type: "image_url" as const, image_url: { url: dataUrl, detail: "high" as const } },
      ];

  const response = await openaiChatCompletion({
    model: input.model ?? "gpt-4o-mini",
    responseFormat: "json_object",
    messages: [
      { role: "system", content: buildSystemPrompt(input.tipos) },
      { role: "user", content: contenido },
    ],
    temperature: 0,
    // Un PDF consolidado puede traer 15+ documentos
    maxTokens: esPdf ? 4000 : 900,
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

    return {
      detectedCodigo: tipo?.codigo ?? "unknown",
      detectedTipoId: tipo?.id ?? null,
      detectedDocTypeLabel: tipo?.nombre ?? "Desconocido",
      expiryDate: normalizeDate(d.expiryDate),
      issueDate: normalizeDate(d.issueDate),
      workerName: cleanString(d.workerName),
      workerRut: normalizeRut(d.workerRut),
      paginaInicio: pagina && pagina > 0 ? pagina : null,
      confidence: (d.confidence as "high" | "medium" | "low") ?? "low",
      reasoning: cleanString(d.reasoning) ?? "",
    };
  });
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && s.toLowerCase() !== "null" ? s : null;
}

function normalizeDate(v: unknown): string | null {
  const s = cleanString(v);
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
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
