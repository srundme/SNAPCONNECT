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
