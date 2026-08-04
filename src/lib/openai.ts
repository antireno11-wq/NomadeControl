/**
 * Cliente mínimo de OpenAI usando fetch nativo — sin SDK.
 *
 * Requiere env: OPENAI_API_KEY
 * Modelo por defecto: gpt-4o-mini (baja latencia, ~$0.15/M in · $0.60/M out)
 */

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
    // PDF directo: OpenAI extrae texto y renderiza cada página como imagen.
    // Evita tener que convertir el PDF a imágenes en el cliente.
    | { type: "file"; file: { filename: string; file_data: string } }
  >;
};

type ChatCompletionResponse = {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export async function openaiChatCompletion(input: {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  responseFormat?: "text" | "json_object";
  maxTokens?: number;
}): Promise<ChatCompletionResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY no configurada en el servidor.");
  }

  const body: Record<string, unknown> = {
    model: input.model ?? "gpt-4o-mini",
    messages: input.messages,
    temperature: input.temperature ?? 0,
    max_tokens: input.maxTokens ?? 1000,
  };
  if (input.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text.slice(0, 500)}`);
  }

  return res.json() as Promise<ChatCompletionResponse>;
}

export function estimateTokens(text: string): number {
  // Aproximación: 1 token ≈ 4 caracteres en español
  return Math.ceil(text.length / 4);
}
