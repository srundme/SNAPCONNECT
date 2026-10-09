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
    expect(prompt).toMatch(/share the exact budget/);
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

describe("no compliments on their answers", () => {
  it("drops commentary but keeps facts and questions", async () => {
    const { dropEmptyPraise } = await import("../src/index");
    expect(dropEmptyPraise("That is a comfortable size sir. Which day and time suits you?")).toBe("Which day and time suits you?");
    expect(dropEmptyPraise("Good to know sir\nA villa in Concord sounds like a lovely project. How many bedrooms does it have?")).toBe("How many bedrooms does it have?");
    expect(dropEmptyPraise("For kitchens we use Century Ply Club Prime BWP plywood which handles moisture well.")).toBe("For kitchens we use Century Ply Club Prime BWP plywood which handles moisture well.");
    expect(dropEmptyPraise("That is a comfortable size sir.")).toBe("That is a comfortable size sir.");
  });
});

describe("names from the profile", () => {
  it("reads a person's name from a profile name or handle, not a brand", async () => {
    const { profilePersonName } = await import("../src/index");
    expect(profilePersonName(null, "riteesh.shetty_93")).toBe("Riteesh Shetty");
    expect(profilePersonName("Priya Nair", "pn_1990")).toBe("Priya Nair");
    expect(profilePersonName(null, "karighars_interiors")).toBeNull();
    expect(profilePersonName(null, "xx_99_xx")).toBeNull();
    expect(profilePersonName("Tech World Official", null)).toBeNull();
  });
});

describe("Hinglish endings", () => {
  it("swaps Tamil endings for Hindi ones", async () => {
    const { hindiEndings } = await import("../src/index");
    expect(hindiEndings("kitchen aur bathroom la Century Ply Club Prime BWP use hota hai aur wardrobe la Century Ply WIN MR"))
      .toBe("kitchen aur bathroom mein Century Ply Club Prime BWP use hota hai aur wardrobe mein Century Ply WIN MR");
    expect(hindiEndings("team ku bata dunga")).toBe("team ko bata dunga");
    expect(hindiEndings("la la land")).toBe("la la land");
  });
});

describe("Varun speaks Hindi as a man", () => {
  it("turns female first-person forms into male ones", async () => {
    const { maleHindi } = await import("../src/index");
    expect(maleHindi("Main team se check karti hoon aur aapko bataungi")).toBe("Main team se check karta hoon aur aapko bataunga");
    expect(maleHindi("main abhi dekh rahi hoon")).toBe("main abhi dekh raha hoon");
    expect(maleHindi("main kar sakti hu")).toBe("main kar sakta hu");
    expect(maleHindi("main bhejungi details")).toBe("main bhejunga details");
    expect(maleHindi("Main team se check karta hoon")).toBe("Main team se check karta hoon");
    expect(maleHindi("Team confirm karegi aapke project ke liye")).toBe("Hum confirm karenge aapke project ke liye");
    expect(maleHindi("hamari team aapko call karegi")).toBe("hum aapko call karenge");
  });
});

describe("Varun speaks for KariGhars as we", () => {
  it("says we instead of the team, drops day announcements, and gives visit hours from today", async () => {
    const { weVoice, dropDayAnnouncement, visitNowLine } = await import("../src/index");
    expect(weVoice("The team will confirm the slot")).toBe("We will confirm the slot");
    expect(weVoice("I have noted it here for the team who will confirm the slot with you")).toBe("I have noted it here and we will confirm the slot with you");
    expect(weVoice("Shall the team call you on this same WhatsApp number?")).toBe("Shall we call you on this same WhatsApp number?");
    expect(weVoice("our team is available Tuesday to Sunday")).toBe("we are available Tuesday to Sunday");
    expect(dropDayAnnouncement("Tomorrow is Saturday sir so that works. What time suits you?")).toBe("What time suits you?");
    const hours = "Tuesday to Sunday, 10 AM to 7 PM, Monday closed";
    expect(visitNowLine(new Date("2026-10-09T05:00:00Z"), hours)).toBe("we're open today till 7 PM, and you can visit any day Tuesday to Sunday, 10 AM to 7 PM");
    expect(visitNowLine(new Date("2026-10-09T14:30:00Z"), hours)).toMatch(/^we're closed for today, so you can visit tomorrow from 10 AM/);
    expect(visitNowLine(new Date("2026-10-12T06:00:00Z"), hours)).toMatch(/^we're closed today, so you can visit tomorrow from 10 AM/);
  });
});

describe("a builder is not a property", () => {
  it("spots a builder named without the property", async () => {
    const { builderOnly } = await import("../src/index");
    expect(builderOnly("Puravankara")).toBe("Puravankara");
    expect(builderOnly("Puravankara at banglore")).toBe("Puravankara");
    expect(builderOnly("it's a Prestige flat")).toBe("Prestige");
    expect(builderOnly("Prestige Lakeside Habitat")).toBeNull();
    expect(builderOnly("Purva Atmosphere, Thanisandra")).toBeNull();
    expect(builderOnly("Sobha, Whitefield")).toBeNull();
    expect(builderOnly("Concorde Manhattans")).toBeNull();
  });
});
