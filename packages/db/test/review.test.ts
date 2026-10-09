import { describe, expect, it } from "vitest";
import { fixtureLlm } from "@snapsocial/integrations";
import { oneQuestion, reviewReply, simulationRuntime } from "../src/index";

describe("second check", () => {
  it("keeps only one question per reply, the last one", () => {
    expect(oneQuestion("Got it a 3BHK\nWhat kind of interiors are you looking for? When do you get possession, or is the home already ready?"))
      .toBe("Got it a 3BHK\nWhen do you get possession, or is the home already ready?");
    expect(oneQuestion("Noted sir. Which area is your home in?")).toBe("Noted sir. Which area is your home in?");
  });

  it("only rewrites the opening words and always keeps the system's question", async () => {
    const runtime = simulationRuntime({
      llm: { ...fixtureLlm(), complete: async () => JSON.stringify({ ok: false, problem: "odd opening", lead: "Noted sir, the 6th works for us. A 4BHK sounds spacious. Which floor is it on?" }) },
    });
    const result = await reviewReply(runtime, {
      customer: "4bhk",
      draft: "Ok to hear sir.\nWhich number should the team call you on?",
      earlier: [],
      askingPrice: false,
      language: "English",
    });
    expect(result?.fixed).toMatch(/Which number should the team call you on\?$/);
    expect(result?.fixed).not.toMatch(/floor/i);
    expect(result?.fixed).not.toMatch(/spacious/i);
  });

  it("leaves a reply with no opening words alone", async () => {
    const runtime = simulationRuntime({ llm: { ...fixtureLlm(), complete: async () => JSON.stringify({ ok: false, problem: "x", lead: "Hello" }) } });
    expect(await reviewReply(runtime, { customer: "hi", draft: "Which BHK is your apartment?", earlier: [], askingPrice: false, language: "English" })).toBeNull();
  });
});
