import { describe, expect, it } from "vitest";
import { fixtureLlm } from "@snapsocial/integrations";
import { oneQuestion, reviewReply, withoutKnownAsks, simulationRuntime } from "../src/index";

describe("second check", () => {
  it("never asks a known name or re-introduces Varun to someone he has met", () => {
    const known = { nameKnown: true, metBefore: true, agentName: "Varun" };
    expect(withoutKnownAsks("Hi this is Varun an automated assistant for The KariGhars\nWelcome back Karthikeyan sir. Could you share your name?", known))
      .toBe("Welcome back Karthikeyan sir.");
    expect(withoutKnownAsks("Could you share your name?", known)).toBe("How can we help you today?");
    expect(withoutKnownAsks("Noted sir. What is the property name, and which area?", known)).toBe("Noted sir. What is the property name, and which area?");
    expect(withoutKnownAsks("Hi, I am Varun from The KariGhars. May I know your name?", { nameKnown: false, metBefore: false, agentName: "Varun" }))
      .toBe("Hi, I am Varun from The KariGhars. May I know your name?");
  });

  it("never asks again for any detail already collected", () => {
    const place = { id: "place", kind: "text" as const, label: "Where is the home: which area, and what is the property name?", required: true, zohoField: null };
    const possession = { id: "possession", kind: "text" as const, label: "When do you get possession, or is the home already ready?", required: true, zohoField: null };
    const known = { nameKnown: true, metBefore: true, agentName: "Varun", collected: [place, possession] };
    expect(withoutKnownAsks("Got it sir. When do you get possession, or is the home already ready?", known)).toBe("Got it sir.");
    expect(withoutKnownAsks("Got it sir. Which area is the home in, and what is the property name?", known)).toBe("Got it sir.");
    expect(withoutKnownAsks("Got it sir. Which property is it in Whitefield?", known)).toBe("Got it sir. Which property is it in Whitefield?");
    expect(withoutKnownAsks("Noted. Which number should the team call you on?", known)).toBe("Noted. Which number should the team call you on?");
  });

  it("never lets the second check invent facts", async () => {
    const runtime = simulationRuntime({
      llm: { ...fixtureLlm(), complete: async () => JSON.stringify({ ok: false, problem: "ignores direct question", lead: "We use a mix of our own premium labels and trusted industry brands." }) },
    });
    const result = await reviewReply(runtime, { customer: "Are you using your own brands", draft: "We use Century Ply and Blum.\nWould you like to visit our experience centre?", earlier: [], askingPrice: false, language: "English" });
    expect(result).toBeNull();
  });

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
    // "the 6th works for us" is a promise the draft never made: the rewrite is refused and the draft goes out as is.
    expect(result).toBeNull();
  });

  it("leaves a reply with no opening words alone", async () => {
    const runtime = simulationRuntime({ llm: { ...fixtureLlm(), complete: async () => JSON.stringify({ ok: false, problem: "x", lead: "Hello" }) } });
    expect(await reviewReply(runtime, { customer: "hi", draft: "Which BHK is your apartment?", earlier: [], askingPrice: false, language: "English" })).toBeNull();
  });
});
