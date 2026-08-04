import { openaiChatCompletion } from "./openai";

/** Tipo del catálogo, tal como lo espera el extractor. */
export type TipoParaExtraccion = {
  id: string;
  codigo: string;
  nombre: string;
};

export type ExtractedDoc = {
  /** Código del catálogo, o "unknown" si no pudo clasificarlo. */
  detectedCodigo: string;
  detectedTipoId: string | null;
  detectedDocTypeLabel: string;
  expiryDate: string | null;         // YYYY-MM-DD o null
  issueDate: string | null;          // YYYY-MM-DD o null
  workerName: string | null;         // según el documento
  workerRut: string | null;          // según el documento
  confidence: "high" | "medium" | "low";
  reasoning: string;                 // breve, para debug
};

function buildSystemPrompt(tipos: TipoParaExtraccion[]) {
  const lista = tipos.map(t => `- ${t.codigo}: ${t.nombre}`).join("\n");
  return `Eres un asistente experto en documentos laborales chilenos. Tu trabajo es extraer información estructurada de fotos/scans de documentos que RRHH sube para el control documental de sus trabajadores.

Los tipos de documento posibles son:
${lista}

Reglas:
- Devuelve SIEMPRE JSON válido con la estructura solicitada.
- Fechas: SIEMPRE en formato YYYY-MM-DD. Si el documento muestra la fecha como 15/06/2027, devuelve "2027-06-15".
- Si NO puedes leer una fecha, devuelve null (no inventes).
- Para el tipo de documento, elige la key EXACTA de la lista de arriba, o "unknown" si no coincide con ninguno.
- Distinguí bien entre fecha de EMISIÓN y fecha de VENCIMIENTO. La que nos interesa es el vencimiento (expiryDate). La emisión (issueDate) es informativa.
- Para el nombre del trabajador: extraé tal como aparece en el documento (incluyendo apellidos).
- Para el RUT: formato chileno, ejemplo "12.345.678-9" o "12345678-9".
- Confidence:
  - "high" = fecha de vencimiento claramente visible y legible
  - "medium" = alguna ambigüedad (fecha borrosa, formato raro, o falta contexto)
  - "low" = imagen mala, campos no visibles, o no seguro si es el tipo correcto
- En "reasoning" pon 1-2 frases explicando en qué te basaste.

Formato JSON exacto:
{
  "detectedCodigo": "<codigo de la lista, o unknown>",
  "expiryDate": "<YYYY-MM-DD o null>",
  "issueDate": "<YYYY-MM-DD o null>",
  "workerName": "<nombre o null>",
  "workerRut": "<rut o null>",
  "confidence": "high|medium|low",
  "reasoning": "<breve>"
}`;
}

/**
 * Recibe una imagen (JPG/PNG/WEBP) en base64, pregunta a OpenAI Vision qué
 * documento es y extrae la fecha de vencimiento.
 *
 * El resultado NUNCA se escribe directo: pasa por confirmación humana. Una
 * fecha mal leída marcaría como vigente algo que no lo está, que es peor
 * que no tener sistema.
 */
export async function extractDocumentInfo(input: {
  imageBase64: string;
  mimeType: string;
  fileName: string;
  tipos: TipoParaExtraccion[];
  model?: string;
}): Promise<ExtractedDoc> {
  const dataUrl = `data:${input.mimeType};base64,${input.imageBase64}`;

  const response = await openaiChatCompletion({
    model: input.model ?? "gpt-4o-mini",
    responseFormat: "json_object",
    messages: [
      { role: "system", content: buildSystemPrompt(input.tipos) },
      {
        role: "user",
        content: [
          { type: "text", text: `Analizá este documento (${input.fileName}) y extraé la info en JSON.` },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
    temperature: 0,
    maxTokens: 600,
  });

  const raw = response.choices[0]?.message.content ?? "";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Respuesta de OpenAI no es JSON válido: ${raw.slice(0, 200)}`);
  }

  const codigo = cleanString(parsed.detectedCodigo) ?? "unknown";
  const tipo = input.tipos.find(t => t.codigo === codigo) ?? null;

  return {
    detectedCodigo: tipo?.codigo ?? "unknown",
    detectedTipoId: tipo?.id ?? null,
    detectedDocTypeLabel: tipo?.nombre ?? "Desconocido",
    expiryDate: normalizeDate(parsed.expiryDate),
    issueDate: normalizeDate(parsed.issueDate),
    workerName: cleanString(parsed.workerName),
    workerRut: normalizeRut(parsed.workerRut),
    confidence: (parsed.confidence as "high" | "medium" | "low") ?? "low",
    reasoning: cleanString(parsed.reasoning) ?? "",
  };
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && s.toLowerCase() !== "null" ? s : null;
}

function normalizeDate(v: unknown): string | null {
  const s = cleanString(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function normalizeRut(v: unknown): string | null {
  const s = cleanString(v);
  if (!s) return null;
  // Deja tal como viene si parece un RUT chileno básico
  if (/^\d{1,2}\.?\d{3}\.?\d{3}-?[0-9kK]$/.test(s)) return s;
  return s;
}

/**
 * Fuzzy match entre el nombre extraído y una lista de trabajadores del sistema.
 * Devuelve los mejores candidatos ordenados por score.
 */
export function matchWorker(
  extracted: { name: string | null; rut: string | null },
  workers: Array<{ id: string; fullName: string; nationalId: string | null }>,
): Array<{ workerId: string; score: number; reason: string }> {
  if (workers.length === 0) return [];

  // 1. Match exacto por RUT normalizado (score 100)
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

  // 2. Score por similaridad de nombre
  const normName = (s: string) =>
    s.toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);

  const extractedTokens = normName(extracted.name);
  if (extractedTokens.length === 0) return [];

  const candidates = workers.map(w => {
    const workerTokens = normName(w.fullName);
    let common = 0;
    for (const t of extractedTokens) {
      if (workerTokens.includes(t)) common++;
    }
    const score = Math.round((common / Math.max(extractedTokens.length, workerTokens.length)) * 100);
    return { workerId: w.id, score, reason: `${common} palabra${common !== 1 ? "s" : ""} en común` };
  });

  return candidates
    .filter(c => c.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
