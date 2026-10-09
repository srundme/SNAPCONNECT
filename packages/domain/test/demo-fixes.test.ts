import { describe, expect, it } from "vitest";
import {
  askingPrice,
  callWaitReply,
  contextChecks,
  customerComplaint,
  deterministicIntent,
  mentionsTwoHomes,
  notAHome,
  notAPlaceSentence,
  platformReplyBlock,
  requestedTime,
} from "../src/index";

// Wednesday 8 Oct 2026, 2:00 PM IST.
const wednesdayAfternoon = new Date("2026-10-08T08:30:00Z");
const hours = "Tuesday to Sunday, 10 AM to 7 PM, Monday closed";

describe("messages from live testing on 8 Oct", () => {
  it("does not treat a question about our office as a commercial enquiry", () => {
    expect(notAHome("where is your office?")).toBe(false);
    expect(notAHome("can I visit your showroom")).toBe(false);
    expect(notAHome("I need interiors for my clinic")).toBe(true);
  });

  it("does not hand off a new lead waiting on the builder as a complaint", () => {
    expect(customerComplaint("my flat possession is pending")).toBe(false);
    expect(customerComplaint("my kitchen work is delayed by 2 months")).toBe(true);
  });

  it("reads 'at the earliest' as a phrase, not a second home", () => {
    expect(mentionsTwoHomes("flat in Whitefield, need home interiors at the earliest")).toBe(false);
    expect(mentionsTwoHomes("one flat in Whitefield and another house in Hebbal")).toBe(true);
  });

  it("puts a named weekday on that day, not today", () => {
    const time = requestedTime("Saturday 11 am", wednesdayAfternoon, hours);
    expect(time?.day).toBe("Saturday");
    expect(time?.inside).toBe(true);
    expect(requestedTime("Monday 11 am", wednesdayAfternoon, hours)?.inside).toBe(false);
  });

  it("skips holidays when saying when the team can call", () => {
    // 1 Oct 2026, 8 PM IST: 2 Oct is Gandhi Jayanti.
    expect(callWaitReply(new Date("2026-10-01T14:30:00Z"), hours)).toMatch(/call u on Saturday/);
  });

  it("does not read 'maybe' or 'marriage' as a month", () => {
    const questions = [{ id: "when", label: "When do you plan to start the interiors?", kind: "text" as const, zohoField: null, required: true }];
    for (const answer of ["maybe 2026 end", "after marriage in 2026"]) {
      const checks = contextChecks({ questions, answers: { when: answer }, now: wednesdayAfternoon, serviceArea: "" });
      expect(checks.map((check) => check.line).join(" ")).not.toMatch(/passed|already gone|in the past/i);
    }
  });

  it("allows a published starting price in rupees", () => {
    expect(platformReplyBlock("for a full home, 3 BHK starts from ₹35 lakh")).toBeFalsy();
  });

  it("knows a name sentence is not a project", () => {
    expect(notAPlaceSentence("Actually my name is RITEESH shetty")).toBe(true);
  });

  it("keeps the earlier fixes", () => {
    expect(askingPrice("how much time will it take for a 4 BHK villa")).toBe(false);
    expect(deterministicIntent("my flat is near the bus stop").optOut).toBe(false);
  });
});

describe("no short forms in replies", () => {
  it("spells out short forms and starts each message with a capital", async () => {
    const { humanBubbles, fullWords } = await import("../src/index");
    expect(fullWords("pls send ur number, im waiting and dont worry thats fine u know")).toBe("Please send your number, I'm waiting and don't worry that's fine you know");
    const bubbles = humanBubbles("Okay sir, please type your number. I'm waiting! Don't worry.", []);
    expect(bubbles.join(" ")).not.toMatch(/\b(?:u|ur|pls|im|dont)\b/);
    for (const bubble of bubbles) expect(bubble).toMatch(/^[A-Z]/);
  });
});

describe("prices are never told to customers", () => {
  it("keeps price lines out of the knowledge base the model sees", async () => {
    const { withoutPrices } = await import("../src/index");
    const kb = "3. STARTING PRICES (published on the website)\n- 3 BHK: starting from ₹35 lakh.\n- Luxury villas: ₹50 lakh and above.\nFounded in 2009.\nExperience centre open Tuesday to Sunday.";
    expect(withoutPrices(kb)).toBe("Founded in 2009.\nExperience centre open Tuesday to Sunday.");
  });

  it("does not offer designers, 3D designs or site visits in the prompt", async () => {
    const { salesBriefing } = await import("../src/index");
    const questions = [{ id: "kind", kind: "text" as const, label: "What kind of home is it, and how many BHK?", required: true, zohoField: null }];
    const prompt = salesBriefing({
      brandName: "The KariGhars", agentName: "Varun", services: "Full-home interiors", faqs: [], teamNotes: null, questions, recorded: [],
      nextDetail: null, ready: true, cold: false, minutesSinceSent: null, memoryLines: [],
      languageLine: "This chat is in English.", chatLanguage: null, activePost: null, otherPosts: null,
      knowledgeBase: "- 3 BHK: starting from ₹35 lakh.",
    } as never);
    expect(prompt).not.toMatch(/₹35|site visit and 3D|designer goes through/);
    expect(prompt).toMatch(/quoted by our team/);
  });
});

describe("no designer talk", () => {
  it("drops design planning lines but keeps the question and place names", async () => {
    const { dropDesignTalk } = await import("../src/index");
    expect(dropDesignTalk("That is convenient since you are in possession we can move ahead with the design planning. Would our team reach you on this number?"))
      .toBe("Would our team reach you on this number?");
    expect(dropDesignTalk("Nice, a villa in HSR Layout. How many BHK is it?")).toBe("Nice, a villa in HSR Layout. How many BHK is it?");
  });
});

describe("the home question needs a BHK count", () => {
  it("is not answered by a home type alone", async () => {
    const { screenLead } = await import("../src/index");
    const questions = [{ id: "kind", kind: "text" as const, label: "What kind of home is it: apartment, villa or independent house, and how many BHK?", required: true, zohoField: null }];
    expect(screenLead({ questions, answers: { kind: "Villa" }, name: "Gopi", phoneE164: "+919999999999" }).ready).toBe(false);
    expect(screenLead({ questions, answers: { kind: "4 BHK Villa" }, name: "Gopi", phoneE164: "+919999999999" }).ready).toBe(true);
    expect(screenLead({ questions, answers: { kind: "5 bedroom villa" }, name: "Gopi", phoneE164: "+919999999999" }).ready).toBe(true);
  });
});
