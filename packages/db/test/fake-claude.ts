import type { Runtime } from "../src/index";

/**
 * A stand-in for Claude in tests: reads FACTS like the real one, picks up a name, phone or email from the latest
 * message, and asks for the next missing detail (or makes the offer). Tests only; production never has a fake.
 */
export function fakeClaude(): NonNullable<Runtime["claude"]> {
  let turn = 0;
  return {
    model: "claude-test",
    async text() { return ""; },
    async json<T>(call: { system: unknown; messages: Array<{ role: string; content: unknown }> }) {
      const system = typeof call.system === "string" ? call.system : (call.system as Array<{ text: string }>).map((block) => block.text).join("\n");
      // The test clock can put their message before our last reply, so read the last real customer message.
      const latest = String([...call.messages].reverse().find((message) => message.role === "user" && !String(message.content).startsWith("("))?.content ?? "");
      const named = latest.match(/\b(?:my name is|this is|i am|i'm)\s+([A-Z][a-z]+)\b/)?.[1] ?? null;
      const phone = latest.match(/\+?\d[\d\s-]{8,}\d/)?.[0] ?? null;
      const email = latest.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] ?? null;
      const missing = system.match(/Still missing \(must-haves\):\n- ([^\n]+)/)?.[1];
      turn += 1;
      const thanks = ["Thank you.", "Got it.", "Noted.", "Perfect.", "Lovely."][turn % 5];
      const bubbles = missing && !named && !phone && !email
        ? [`${thanks} ${missing.replace(/\?*$/, "?")}`]
        : missing
          ? [`${thanks} Noted, thank you.`]
          : [`${thanks} Shall I book a free consultation for you, or would you like to visit our experience centre?`];
      return { bubbles, details: { name: named, phone, email }, declined: [], follow_up_at: null, new_home: false, offer_choice: null, slot: null, handoff: false, flag: null, opt_out: false } as T;
    },
  };
}
