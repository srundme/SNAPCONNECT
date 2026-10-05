import { aiOutputSchema, CALLBACK_TIME_KEY, parseBudget, type AiOutput } from "@snapsocial/domain";
import { neutralDirection, VOICE_EMOTIONS, VOICE_OPENERS, type VoiceDirection } from "./cartesia";

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
  addressFor?(name: string): Promise<"sir" | "mam" | "bro">;
  readName?(question: string, reply: string): Promise<string | null>;
  extractAnswers?(input: {
    questions: Array<{ id: string; label: string; kind: string; numeric: boolean }>;
    transcript: Array<{ author: string; body: string }>;
  }): Promise<Record<string, unknown>>;
  directVoice?(input: { customer: string; reply: string; earlier: string }): Promise<VoiceDirection>;
  health(): Promise<{ ok: boolean; detail: string; gpu: boolean | null }>;
};

export function readVoiceDirection(value: unknown): VoiceDirection {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const emotion = VOICE_EMOTIONS.find((item) => item === String(raw.emotion ?? "").toLowerCase()) ?? neutralDirection.emotion;
  const opener = VOICE_OPENERS.find((item) => item.toLowerCase() === String(raw.opener ?? "").trim().toLowerCase()) ?? "";
  const speed = Number(raw.speed);
  return {
    emotion,
    speed: Number.isFinite(speed) ? Math.min(1.15, Math.max(0.85, speed)) : 1,
    opener,
  };
}

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

const addressCache = new Map<string, "sir" | "mam" | "bro">();

class SarvamError extends Error {
  constructor(message: string, readonly temporary: boolean) {
    super(message);
  }
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
    async addressFor(name) {
      const key = name.trim().toLowerCase();
      const cached = addressCache.get(key);
      if (cached) return cached;
      const response = await fetchImpl("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", "api-subscription-key": options.apiKey },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 20,
          messages: [
            {
              role: "system",
              content: [
                "You decide how an Indian sales executive should address a customer, from their name or Instagram handle.",
                "Answer with exactly one word: sir for a man's name, mam for a woman's name, bro if it is a brand, a page, or there is no personal name.",
                "Examples: Gopi = sir. gopi talks = sir. Karthikeyan = sir. Rahul Sharma = sir. Arun = sir. Vijay = sir. Ravi = sir. Krishna = sir.",
                "Priya = mam. Neha = mam. Divya = mam. Lakshmi = mam. Swathi = mam. Kavya = mam. Anjali = mam.",
                "tech world official = bro. glow studio = bro. the aitel ai = bro.",
              ].join("\n"),
            },
            { role: "user", content: name.normalize("NFKC").replace(/[._\-@]+/g, " ").slice(0, 120) },
          ],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`Sarvam returned HTTP ${response.status}`);
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const word = (body.choices?.[0]?.message?.content ?? "").toLowerCase().match(/\b(sir|mam|madam|ma'am|bro)\b/)?.[1];
      const address = word === "sir" ? "sir" : word === "bro" || !word ? "bro" : "mam";
      addressCache.set(key, address);
      return address;
    },
    async extractAnswers({ questions, transcript }) {
      const fields = questions.map((question) => {
        const rule = question.kind === "name"
          ? "the customer's own person name, with surname or initial if given. Not a greeting, filler (arey, dei, bhai, acha), company or city."
          : question.kind === "phone"
            ? "their mobile number exactly as typed."
            : question.kind === "yesno"
              ? "\"yes\" or \"no\" only."
              : question.numeric
                ? "a plain number in digits. Convert words and short forms: 40k = 40000, 2 lakh = 200000, dho hazar = 2000, rendu aayiram = 2000. For people counts, Tamil 'per' or 'peru' and Hindi 'log' after a number mean people: '20 per iruken' = 20, '8 log' = 8."
                : /company/i.test(question.label)
                  ? "only the business or company name, as typed. Not a sentence about something else."
                  : "their answer in their own words, short.";
        return `- "${question.id}" (${question.label}): ${rule}`;
      });
      fields.push(`- "${CALLBACK_TIME_KEY}" (Preferred call time): when they want the team to call them, exactly as they typed, like "Tom 2 pm" or "naalaiku evening". Null if they did not say.`);
      const chat = transcript
        .filter((message) => message.author === "AI" || message.author === "PROSPECT")
        .slice(-30)
        .map((message) => `${message.author === "AI" ? "Assistant" : "Customer"}: ${message.body.replace(/\s+/g, " ").slice(0, 400)}`)
        .join("\n");
      const response = await fetchImpl("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", "api-subscription-key": options.apiKey },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 500,
          messages: [
            {
              role: "system",
              content: [
                "You fill a sales lead form from an Instagram chat between a sales assistant and an Indian customer.",
                "The chat can be English, Tamil, Hindi, Tanglish, Hinglish or mixed, with typos and stretched letters.",
                "Use only what the Customer typed. The Assistant's lines only tell you what was being asked.",
                "An answer counts even when the Assistant asked without a question mark, or when the Customer gave it before being asked.",
                "If the Customer corrected an answer, use the latest one. If a field was not answered, use null. Never guess.",
                "A question, a refusal, or a language request is not an answer.",
                "Return only one JSON object with exactly these keys:",
                ...fields,
              ].join("\n"),
            },
            { role: "user", content: chat },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Sarvam returned HTTP ${response.status}`);
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = (body.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "");
      const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
      if (!json) throw new Error("Sarvam returned no JSON for the lead form.");
      const parsed = JSON.parse(json) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Sarvam lead form was not an object.");
      return parsed as Record<string, unknown>;
    },
    async readName(question, reply) {
      const response = await fetchImpl("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", "api-subscription-key": options.apiKey },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 30,
          messages: [
            {
              role: "system",
              content: [
                "You read a customer's Instagram reply to a sales assistant and pull out the customer's own name.",
                "The reply can be English, Tamil, Hindi, Tanglish or Hinglish, with spelling mistakes and stretched letters.",
                "Answer with only the name exactly as they wrote it, keeping the surname or initial. Answer NONE when there is no name.",
                "Drop words around the name like my name is, I am, this is, myself, naan, en peru, mera naam, sir, bro, bhai, anna, ji.",
                "Answer NONE for greetings and fillers (hi, arey, areee bhai, dei, acha, ok, haan, seri), questions, company or brand names, cities, numbers, or a refusal.",
                "If they correct an earlier name, answer the new name. Never guess or invent a name.",
                "Examples:",
                "Assistant: May I have your name? | Customer: Karthikeyan R → Karthikeyan R",
                "Assistant: Unga peru enna? | Customer: en peru gopi da → gopi",
                "Assistant: Aapka naam kya hai? | Customer: Mera naam Rahul Sharma hai → Rahul Sharma",
                "Assistant: May I have your name? | Customer: Areee bhaiiii → NONE",
                "Assistant: May I have your name? | Customer: why do you need my name → NONE",
                "Assistant: Which company? | Customer: myself priya from glow studio → priya",
                "Assistant: Thanks Gopi sir. | Customer: no sir my name is Gopinath → Gopinath",
              ].join("\n"),
            },
            { role: "user", content: `Assistant: ${question.slice(0, 300)} | Customer: ${reply.slice(0, 300)}` },
          ],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Sarvam returned HTTP ${response.status}`);
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const answer = (body.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").split("\n").map((line) => line.trim()).filter(Boolean).pop() ?? "";
      const name = answer.replace(/^.*(?:→|->|:)\s*/, "").replace(/["'`.]+/g, "").trim();
      return !name || /^none$/i.test(name) ? null : name;
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
    async directVoice({ customer, reply, earlier }) {
      const response = await fetchImpl("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", "api-subscription-key": options.apiKey },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 120,
          messages: [
            {
              role: "system",
              content: [
                "You direct the voice actor who speaks a friendly Indian sales assistant's reply as a voice note.",
                "Read the customer's last message and the assistant's reply, then choose how the reply should sound.",
                "The chat can be English, Tamil, Hindi, Tanglish, Hinglish or mixed.",
                `emotion: one of ${VOICE_EMOTIONS.join(", ")}. Match the reply: thanks = grateful, sorry or a problem = apologetic or sympathetic, good news = happy or excited, a question = curious, details = calm or confident.`,
                "speed: 0.9 for careful details like numbers or times, 1.0 normally, 1.1 for short cheerful replies.",
                `opener: one of ${VOICE_OPENERS.filter(Boolean).map((item) => `"${item}"`).join(", ")} or "" for none. Use one only for real surprise ("Oh,", "Wow,") or sympathy ("Aww,"), never on a plain question or answer. Most replies use "".`,
                'Return only JSON like {"emotion":"content","speed":1.0,"opener":""}.',
              ].join("\n"),
            },
            {
              role: "user",
              content: `Earlier chat:\n${earlier.slice(-1200) || "none"}\n\nCustomer's last message: ${customer.slice(0, 500)}\nAssistant's reply: ${reply.slice(0, 800)}`.normalize("NFKC"),
            },
          ],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`Sarvam returned HTTP ${response.status}`);
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = (body.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "");
      const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
      if (!json) throw new Error("Sarvam returned no voice direction.");
      return readVoiceDirection(JSON.parse(json) as unknown);
    },
    async generate(request): Promise<LlmResponse> {
      const started = Date.now();
      const messages = [
        { role: "system", content: request.system.normalize("NFKC") },
        ...request.messages
          .filter((message) => message.content.trim())
          .map((message) => ({ role: message.role, content: message.content.normalize("NFKC") })),
      ];
      const call = async (body: Record<string, unknown>): Promise<string> => {
        const response = await fetchImpl("https://api.sarvam.ai/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", "api-subscription-key": options.apiKey },
          body: JSON.stringify({ model, messages, ...body }),
          signal: AbortSignal.timeout(25_000),
        });
        if (!response.ok) {
          const detail = (await response.text().catch(() => "")).slice(0, 200);
          throw new SarvamError(`Sarvam returned HTTP ${response.status} ${detail}`.trim(), response.status === 429 || response.status >= 500);
        }
        const parsed = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        return parsed.choices?.[0]?.message?.content ?? "";
      };
      const failures: string[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const content = await call({
            temperature: attempt === 0 ? 0.4 : 0.2,
            max_tokens: Math.max(options.maxOutputTokens, 1024),
            response_format: { type: "json_schema", json_schema: { name: "qualification", strict: true, schema: AI_JSON_SCHEMA } },
          });
          return { output: parseModelContent(content || "{}"), model, latencyMs: Date.now() - started, simulated: false, diagnostics: { mode: "sarvam", attempts: attempt + 1 } };
        } catch (error) {
          failures.push(error instanceof Error ? error.message.slice(0, 120) : String(error));
          const temporary = !(error instanceof SarvamError) || error.temporary;
          if (!temporary && !(error instanceof SyntaxError)) break;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
        }
      }
      try {
        const text = await call({
          temperature: 0.3,
          max_tokens: 400,
          messages: [
            ...messages.slice(0, 1),
            { role: "system", content: "Write only the message you will send to the person now. No JSON, no labels, no quotes." },
            ...messages.slice(1),
          ],
        });
        const reply = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
        if (!reply || reply.startsWith("{")) throw new Error("Plain reply was empty.");
        return {
          output: { reply: reply.slice(0, 900), field_updates: [], handoff_requested: false, handoff_reason: null },
          model,
          latencyMs: Date.now() - started,
          simulated: false,
          diagnostics: { mode: "sarvam-plain", failures: failures.join(" | ") },
        };
      } catch (error) {
        failures.push(error instanceof Error ? error.message.slice(0, 120) : String(error));
        throw new Error(`Sarvam failed: ${failures.join(" | ")}`);
      }
    },
  };
}

const META_MEDIA_HOST = /(^|\.)(fbsbx\.com|fbcdn\.net|cdninstagram\.com|facebook\.com|instagram\.com)$/;

export function sarvamTranscriber(options: { apiKey: string; fetchImpl?: typeof fetch }) {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (audioUrl: string, bearerToken?: string): Promise<string> => {
    const source = new URL(audioUrl);
    if (source.protocol !== "https:" || !META_MEDIA_HOST.test(source.hostname)) {
      throw new Error("Voice message URL is not a Meta media host.");
    }
    const download = await fetchImpl(source, {
      ...(bearerToken ? { headers: { Authorization: `Bearer ${bearerToken}` } } : {}),
      signal: AbortSignal.timeout(20_000),
    });
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
