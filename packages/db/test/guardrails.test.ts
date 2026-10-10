import { describe, expect, it } from "vitest";
import { ruleBreaks, type RuleContext } from "../src/brain-turn";

const context = (extra: Partial<RuleContext> = {}): RuleContext => ({
  latest: "hi",
  allowedText: "Century Ply BWP plywood. Blum hinges. https://www.thekarighars.com/videos/ https://www.thekarighars.com/karighars-experience-center/ +91 70227 25656 support@thekarighars.com",
  allowedPhones: ["+916383653279", "+91 70227 25656"],
  allowedEmails: ["karthik@theaitel.com"],
  previousAi: ["Could you please share your email?"],
  otherFirm: null,
  ...extra,
});

describe("guardrails on Claude's words", () => {
  it("passes a clean reply", () => {
    expect(ruleBreaks(["We use Blum soft-close hinges, sir.", "Could you please share your email?"], context({ previousAi: [] }))).toEqual([]);
  });
  it("catches each never-rule", () => {
    const check = (text: string, extra: Partial<RuleContext> = {}) => ruleBreaks([text], context(extra)).join(" ");
    expect(check("It starts from 35 lakhs.")).toMatch(/price/);
    expect(check("We finish a full home in 60 days.")).toMatch(/how long/);
    expect(check("Your visit is booked for 4 PM.")).toMatch(/booked/);
    expect(check("See https://fake.example.com/offer")).toMatch(/link/);
    expect(check("Call us on 9876543210.")).toMatch(/phone number/);
    expect(check("Write to sales@karighars.in")).toMatch(/email/);
    expect(check("We use Hettich hinges.")).toMatch(/hettich/i);
    expect(check("We are better than Livspace.")).toMatch(/another company/);
    expect(check("We are unlike The Decor Interiors.", { otherFirm: "The Decor Interiors" })).toMatch(/another company/);
    expect(check("You get a 10% off discount this month.")).toMatch(/discount/);
    expect(check("The FACTS say you are in Whitefield.")).toMatch(/systems/);
    expect(check("Could you please share your email?")).toMatch(/repeats/);
    expect(check("Which area is it? And how many BHK?")).toMatch(/more than one question/);
  });
  it("allows the customer's own number, our contact, and known links", () => {
    expect(ruleBreaks(["Our team will call you on +91 63836 53279 to confirm.", "You can see our work here: https://www.thekarighars.com/videos/"], context({ previousAi: [] }))).toEqual([]);
  });
});

describe("question count", () => {
  it("does not count the ? inside a link", () => {
    const context = { latest: "", allowedText: "https://www.youtube.com/watch?v=tSh1xAt-Tmg", allowedPhones: [], allowedEmails: [], previousAi: [], otherFirm: null };
    expect(ruleBreaks(["We have done a villa there: https://www.youtube.com/watch?v=tSh1xAt-Tmg", "May I know your name?"], context)).toEqual([]);
  });
});

describe("refusals are not offers", () => {
  const base = { allowedText: "", allowedPhones: [], allowedEmails: [], previousAi: [], otherFirm: null };
  it("lets Varun say no to a per sq ft rate or a discount they asked about", () => {
    expect(ruleBreaks(["We don't work with a per sq ft rate, sir. It depends on your home and materials."], { ...base, latest: "what is your per sqft rate" })).toEqual([]);
    expect(ruleBreaks(["I am not able to confirm any discount here, our team will discuss it with you."], { ...base, latest: "any discount if I sign this week?" })).toEqual([]);
  });
  it("still stops a rate or a discount figure", () => {
    expect(ruleBreaks(["It is about 1800 per sq ft."], { ...base, latest: "rate?" }).length).toBe(1);
    expect(ruleBreaks(["We can give a 10% discount."], { ...base, latest: "any discount?" }).length).toBe(1);
    expect(ruleBreaks(["We have a festive discount running now."], { ...base, latest: "hello" }).length).toBe(1);
  });
});

describe("phone agreed in words", () => {
  it("saves the WhatsApp number when they say same number in any wording", async () => {
    const { readDetails } = await import("../src/brain-turn");
    const questions = [{ id: "phone", kind: "phone", label: "Phone number", required: true }] as never;
    for (const said of ["Same WhatsApp number", "yes this one", "same"]) {
      const read = readDetails({ answer: { bubbles: [], details: { phone: said } } as never, questions, answers: {}, whatsappE164: "+919845012345", region: "IN" });
      expect(read.phoneE164).toBe("+919845012345");
      expect(read.problems).toEqual([]);
    }
  });
});

describe("lead question roles", () => {
  it("reads the place question by its label even when it is saved as a name question", async () => {
    const { roleOf } = await import("../src/brain-turn");
    expect(roleOf({ id: "p", kind: "name", label: "Where is the home: which area, and what is the property name?", required: true } as never)).toBe("place");
    expect(roleOf({ id: "n", kind: "name", label: "May I know your name?", required: true } as never)).toBe("name");
  });
});

describe("property outside the city we serve", () => {
  it("says so for Chennai, never for Bangalore or Bengaluru", async () => {
    const { placeFacts } = await import("../src/brain-turn");
    const { defaultAgentSettings } = await import("@snapsocial/domain");
    const agent = { ...defaultAgentSettings, serviceArea: "Bengaluru, Bangalore" };
    const at = (city: string) => placeFacts({ place: "x", found: { name: "P", locality: null, city }, agent }).join(" ");
    expect(at("Chennai")).toMatch(/outside the cities we take up/);
    expect(at("Bangalore")).not.toMatch(/outside/);
    expect(at("Bengaluru")).not.toMatch(/outside/);
  });
});
