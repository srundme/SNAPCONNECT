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
  mode: "ollama" | "fixture";
  model: string;
  generate(request: LlmRequest): Promise<LlmResponse>;
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

export function assertPrivateOllamaUrl(value: string): URL {
  const base = new URL(value);
  const host = base.hostname;
  const privateHost = host === "127.0.0.1" || host === "localhost" || host.endsWith(".railway.internal");
  if (base.protocol !== "http:" || !privateHost) {
    throw new Error("Ollama must stay on a private address.");
  }
  return base;
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
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
      const body = (await response.json()) as { message?: { content?: string } };
      const output = aiOutputSchema.parse(JSON.parse(body.message?.content ?? "{}"));
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
