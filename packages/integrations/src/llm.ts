import { aiOutputSchema, parseBudget, type AiOutput } from "@snapsocial/domain";

export type LlmRequest = {
  system: string;
  messages: Array<{ id: string; role: "user" | "assistant"; content: string }>;
  schemaName: string;
};

const AI_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string" },
    field_updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string" },
          value: { type: "string" },
          source_message_id: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["field", "value", "source_message_id", "evidence"],
      },
    },
    handoff_requested: { type: "boolean" },
    handoff_reason: { type: ["string", "null"] },
  },
  required: ["reply", "field_updates", "handoff_requested", "handoff_reason"],
} as const;

export type LlmResponse = {
  output: AiOutput;
  model: string;
  latencyMs: number;
  simulated: boolean;
  diagnostics: Record<string, string | number | null>;
};

export type LlmProvider = {
  mode: "ollama" | "fixture" | "sarvam";
  model: string;
  generate(request: LlmRequest): Promise<LlmResponse>;
  summarize?(previous: string | null, transcript: string): Promise<string>;
  health(): Promise<{ ok: boolean; detail: string; gpu: boolean | null }>;
};

export function fixtureLlm(): LlmProvider {
  return {
    mode: "fixture",
    model: "labelled-fixture",
    async health() {
      return { ok: true, detail: "Labelled fixture extractor. This is not a live model.", gpu: null };
    },
    async generate(request) {
      const started = Date.now();
      const latest = [...request.messages].reverse().find((message) => message.role === "user");
      const text = latest?.content ?? "";
      const sourceId = latest?.id ?? "missing";
      const field_updates: AiOutput["field_updates"] = [];
      const push = (field: string, value: string, evidence: string) => {
        field_updates.push({ field, value, source_message_id: sourceId, evidence });
      };
      const city = text.match(/\b(?:in|at)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
      if (city?.[0] && city[1]) push("city", city[1], city[0]);
      const projectWord = text.match(/commercial|office|shop|retail|home|house|residential|apartment|flat|villa/i)?.[0];
      if (projectWord) push("projectType", projectWord, projectWord);
      const budgetPhrase = text.match(
        /(?:₹|rs\.?\s*|inr\s*)?\d[\d,]*(?:\.\d+)?(?:\s*(?:-|–|to)\s*\d[\d,]*(?:\.\d+)?)?\s*(?:lakhs?|lacs?|crores?|cr|k|thousand)/i,
      );
      if (budgetPhrase?.[0]) {
        const budget = parseBudget(budgetPhrase[0]);
        if (budget.kind === "amount" || budget.kind === "range") push("budgetRaw", budget.raw, budget.raw);
      } else if (/\b(not sure|prefer not|don't want to share)\b/i.test(text)) {
        const declined = text.match(/not sure|prefer not|don't want to share/i)?.[0] ?? "not sure";
        push("budgetRaw", declined, declined);
      }
      const phone = text.match(/(?:\+\d{1,3}[\s-]?)?(?:\d[\s-]?){10,14}/);
      if (phone?.[0] && text.toLowerCase().includes("whatsapp") && text.toLowerCase().includes("different")) {
        const parts = text.match(/(\+?\d[\d\s-]{8,}\d)/g) ?? [];
        if (parts[0]) push("phoneRaw", parts[0], parts[0]);
        if (parts[1]) push("whatsappRaw", parts[1], parts[1]);
      } else if (phone?.[0]) {
        push("phoneRaw", phone[0], phone[0]);
        if (/same number|whatsapp is the same|same for whatsapp/i.test(text)) push("sameNumber", "true", text.match(/same number|whatsapp is the same|same for whatsapp/i)?.[0] ?? "same number");
      }
      if (/you can call|please call|call me|follow up/i.test(text)) {
        push("phonePermission", "true", text.match(/you can call|please call|call me|follow up/i)?.[0] ?? "call");
      }
      if (/whatsapp/i.test(text) && /you can|please|ok/i.test(text)) {
        push("whatsappPermission", "true", "WhatsApp");
      }
      const timeframe = text.match(/\b(next month|this month|immediately|in \d+ weeks|june|july|august)\b/i);
      if (timeframe?.[0]) push("timeframeRaw", timeframe[0], timeframe[0]);
      if (text.length > 20) push("requirement", text.slice(0, 180), text.slice(0, 180));
      const human = /\b(human|person|agent)\b/i.test(text);
      const output: AiOutput = {
        reply: "",
        field_updates,
        handoff_requested: human,
        handoff_reason: human ? "The person asked for staff." : null,
      };
      return {
        output,
        model: "labelled-fixture",
        latencyMs: Date.now() - started,
        simulated: true,
        diagnostics: { mode: "fixture" },
      };
    },
  };
}

function readJson(content: string): Record<string, unknown> {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    const trimmed = content.trimEnd().replace(/,$/, "");
    if (trimmed.startsWith("{") && !trimmed.endsWith("}")) {
      try {
        return JSON.parse(`${trimmed}\n}`) as Record<string, unknown>;
      } catch {}
    }
    const reply = content.match(/"reply"\s*:\s*("(?:[^"\\]|\\.)*")/)?.[1];
    if (!reply) throw error;
    return { reply: JSON.parse(reply) as string, field_updates: [], handoff_requested: false, handoff_reason: null };
  }
}

function parseModelContent(content: string): AiOutput {
  const raw = readJson(content) as { field_updates?: unknown; handoff_requested?: unknown; handoff_reason?: unknown };
  if (typeof raw.handoff_requested !== "boolean") raw.handoff_requested = raw.handoff_requested === "true";
  if (typeof raw.handoff_reason !== "string") raw.handoff_reason = null;
  if (raw.handoff_requested === true && !raw.handoff_reason) raw.handoff_reason = "The person asked for staff.";
  const parsed = aiOutputSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (Array.isArray(raw.field_updates)) {
    raw.field_updates = raw.field_updates.filter((item) => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      return [row.field, row.value, row.source_message_id, row.evidence].every((value) => typeof value === "string" && value.trim().length > 0);
    });
  }
  return aiOutputSchema.parse(raw);
}

export function assertPrivateOllamaUrl(value: string): URL {
  const base = new URL(value);
  const host = base.hostname;
  const privateHost = host === "127.0.0.1" || host === "localhost" || host.endsWith(".railway.internal");
  const krutrimGpu = host.endsWith(".aipod.olakrutrimsvc.com");
  if (krutrimGpu && base.protocol === "https:") return base;
  if (base.protocol !== "http:" || !privateHost) {
    throw new Error("Ollama must stay on a private address.");
  }
  return base;
}

export function sarvamLlm(options: {
  apiKey: string;
  maxOutputTokens: number;
  model?: string;
  fetchImpl?: typeof fetch;
}): LlmProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? "sarvam-105b-conversations";
  return {
    mode: "sarvam",
    model,
    async health() {
      if (!options.apiKey.trim()) return { ok: false, detail: "SARVAM_API_KEY is empty.", gpu: null };
      return { ok: true, detail: "Sarvam conversation model is configured.", gpu: null };
    },
    async summarize(previous, transcript) {
      const response = await fetchImpl("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", "api-subscription-key": options.apiKey },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 400,
          messages: [
            {
              role: "system",
              content: [
                "You keep a sales assistant's memory of one prospect.",
                "Merge the previous memory with the new chat lines into at most 8 short bullet points.",
                "Keep: who they are, their business, what they need, objections or questions they raised, what was promised, and where the conversation stopped.",
                "Only write facts that appear in the text. No greetings, no advice.",
              ].join("\n"),
            },
            { role: "user", content: `Previous memory:\n${previous?.trim() || "none"}\n\nNew chat lines:\n${transcript}`.normalize("NFKC") },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Sarvam returned HTTP ${response.status}`);
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return (body.choices?.[0]?.message?.content ?? "").trim().slice(0, 2000);
    },
    async generate(request) {
      const started = Date.now();
      const response = await fetchImpl("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "api-subscription-key": options.apiKey,
        },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: Math.max(options.maxOutputTokens, 1024),
          messages: [
            { role: "system", content: request.system.normalize("NFKC") },
            ...request.messages
              .filter((message) => message.content.trim())
              .map((message) => ({ role: message.role, content: message.content.normalize("NFKC") })),
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "qualification",
              strict: true,
              schema: AI_JSON_SCHEMA,
            },
          },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        throw new Error(`Sarvam returned HTTP ${response.status} ${detail}`.trim());
      }
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const output = parseModelContent(body.choices?.[0]?.message?.content ?? "{}");
      return {
        output,
        model,
        latencyMs: Date.now() - started,
        simulated: false,
        diagnostics: { mode: "sarvam" },
      };
    },
  };
}

const META_MEDIA_HOST = /(^|\.)(fbsbx\.com|fbcdn\.net|cdninstagram\.com|facebook\.com|instagram\.com)$/;

export function sarvamTranscriber(options: { apiKey: string; fetchImpl?: typeof fetch }) {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (audioUrl: string): Promise<string> => {
    const source = new URL(audioUrl);
    if (source.protocol !== "https:" || !META_MEDIA_HOST.test(source.hostname)) {
      throw new Error("Voice message URL is not a Meta media host.");
    }
    const download = await fetchImpl(source, { signal: AbortSignal.timeout(20_000) });
    if (!download.ok) throw new Error(`Voice download returned HTTP ${download.status}`);
    const audio = await download.arrayBuffer();
    if (audio.byteLength > 10_000_000) throw new Error("Voice message is too large.");
    const served = download.headers.get("content-type")?.split(";")[0] ?? "";
    const type = served.startsWith("audio/") && !served.includes("mp4") ? served : "audio/mp4";
    const extension = type.includes("ogg") ? "ogg" : type.includes("mpeg") ? "mp3" : type.includes("wav") ? "wav" : "mp4";
    const form = new FormData();
    form.append("file", new Blob([audio], { type }), `voice.${extension}`);
    form.append("model", "saaras:v4");
    form.append("mode", "translit");
    form.append("language_code", "unknown");
    const response = await fetchImpl("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": options.apiKey },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      throw new Error(`Sarvam speech-to-text returned HTTP ${response.status} ${detail}`.trim());
    }
    const body = (await response.json()) as { transcript?: string };
    return (body.transcript ?? "").trim().slice(0, 1000);
  };
}

export function ollamaLlm(options: {
  baseUrl: string;
  model: string;
  maxOutputTokens: number;
  fetchImpl?: typeof fetch;
}): LlmProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = assertPrivateOllamaUrl(options.baseUrl);
  return {
    mode: "ollama",
    model: options.model,
    async health() {
      try {
        const response = await fetchImpl(`${base.origin}/api/ps`, { signal: AbortSignal.timeout(5_000) });
        const body = (await response.json()) as { models?: Array<{ name?: string; size_vram?: number }> };
        const loaded = body.models?.find((item) => item.name?.includes(options.model.split(":")[0] ?? options.model));
        return {
          ok: response.ok,
          detail: response.ok ? "Ollama responded." : "Ollama health check failed.",
          gpu: loaded ? (loaded.size_vram ?? 0) > 0 : null,
        };
      } catch {
        return { ok: false, detail: "Ollama is not reachable.", gpu: null };
      }
    },
    async generate(request) {
      const started = Date.now();
      const response = await fetchImpl(`${base.origin}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          think: false,
          stream: false,
          messages: [{ role: "system", content: request.system }, ...request.messages],
          format: AI_JSON_SCHEMA,
          options: { num_predict: options.maxOutputTokens, num_ctx: 4096 },
        }),
        signal: AbortSignal.timeout(480_000),
      });
      if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
      const body = (await response.json()) as { message?: { content?: string } };
      const output = parseModelContent(body.message?.content ?? "{}");
      return {
        output,
        model: options.model,
        latencyMs: Date.now() - started,
        simulated: false,
        diagnostics: { mode: "ollama" },
      };
    },
  };
}
