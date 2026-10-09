/**
 * Claude (Anthropic Messages API). Two shapes: free text, and a forced tool call that returns JSON matching a schema,
 * which is how the brain gets typed readings and typed replies. Images and PDFs ride along as content blocks.
 */

export const CLAUDE_MODEL = "claude-opus-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";

export type ClaudeBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } | { type: "url"; url: string } };

export type ClaudeMessage = { role: "user" | "assistant"; content: string | ClaudeBlock[] };

export type ClaudeCall = {
  /** A string, or blocks where the stable part carries cache_control so it is not re-read every turn. */
  system: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  messages: ClaudeMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

export class ClaudeError extends Error {
  constructor(message: string, readonly temporary: boolean) {
    super(message);
  }
}

export type Claude = {
  model: string;
  text(call: ClaudeCall): Promise<string>;
  /** Forces one tool call and returns its input: JSON shaped by `schema`. */
  json<T>(call: ClaudeCall & { name: string; description: string; schema: Record<string, unknown>; serverTools?: Array<Record<string, unknown>> }): Promise<T>;
};

export function claudeClient(options: { apiKey: string; model?: string; fetchImpl?: typeof fetch }): Claude {
  const model = options.model ?? CLAUDE_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  async function send(body: Record<string, unknown>, timeoutMs: number): Promise<{ content: Array<Record<string, unknown>>; stop_reason?: string }> {
    let lastError: ClaudeError | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(API_URL, {
          method: "POST",
          headers: { "x-api-key": options.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model, ...body }),
          signal: controller.signal,
        });
        if (response.ok) return (await response.json()) as { content: Array<Record<string, unknown>>; stop_reason?: string };
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        const temporary = response.status === 429 || response.status === 529 || response.status >= 500;
        lastError = new ClaudeError(`Claude ${response.status}: ${detail}`, temporary);
        if (!temporary) throw lastError;
      } catch (error) {
        if (error instanceof ClaudeError && !error.temporary) throw error;
        lastError = error instanceof ClaudeError ? error : new ClaudeError(error instanceof Error ? error.message : String(error), true);
      } finally {
        clearTimeout(timer);
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
    throw lastError ?? new ClaudeError("Claude did not answer.", true);
  }

  const base = (call: ClaudeCall) => ({
    system: call.system,
    messages: call.messages,
    max_tokens: call.maxTokens ?? 1500,
    ...(call.temperature !== undefined ? { temperature: call.temperature } : {}),
  });

  return {
    model,
    async text(call) {
      const result = await send(base(call), call.timeoutMs ?? 60_000);
      return result.content.filter((block) => block.type === "text").map((block) => String(block.text ?? "")).join("").trim();
    },
    async json<T>(call: ClaudeCall & { name: string; description: string; schema: Record<string, unknown>; serverTools?: Array<Record<string, unknown>> }) {
      // Opus does not take a forced tool_choice, so the tool is offered and the instruction says to always use it.
      const withTool = {
        ...base({ ...call, system: typeof call.system === "string"
          ? `${call.system}\n\nAlways answer by calling the ${call.name} tool exactly once. Never answer in plain text.`
          : [...call.system, { type: "text" as const, text: `Always answer by calling the ${call.name} tool exactly once. Never answer in plain text.` }] }),
        tools: [...(call.serverTools ?? []), { name: call.name, description: call.description, input_schema: call.schema }],
        tool_choice: { type: "auto" },
      };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let body: Record<string, unknown> = withTool;
        // A server tool (web search) may pause a long turn: hand its work back and let it finish.
        for (let step = 0; step < 4; step += 1) {
          const result = await send(body, call.timeoutMs ?? 60_000);
          const used = result.content.find((block) => block.type === "tool_use" && block.name === call.name);
          if (used) return used.input as T;
          if (result.stop_reason !== "pause_turn") break;
          body = { ...withTool, messages: [...(withTool.messages as unknown[]), { role: "assistant", content: result.content }] };
        }
      }
      throw new ClaudeError(`Claude did not call ${call.name}.`, true);
    },
  };
}
