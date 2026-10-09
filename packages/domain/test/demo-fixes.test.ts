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
    expect(profilePersonName(null, "gopi.talks")).toBe("Gopi");
    expect(profilePersonName(null, "priya_vlogs")).toBe("Priya");
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

describe("email checks", () => {
  it("spots fake, throwaway, mistyped and keyboard-mashed emails", async () => {
    const { emailProblem } = await import("../src/index");
    expect(emailProblem("hfjdfnjknjk@gmail.com")).toEqual({ kind: "gibberish" });
    expect(emailProblem("Adc@abc.com")).toEqual({ kind: "placeholder" });
    expect(emailProblem("test@gmail.com")).toEqual({ kind: "placeholder" });
    expect(emailProblem("ravi@mailinator.com")).toEqual({ kind: "disposable" });
    expect(emailProblem("karthik@gmial.com")).toEqual({ kind: "typo", suggestion: "karthik@gmail.com" });
    expect(emailProblem("karthik at gmail")).toEqual({ kind: "format" });
    expect(emailProblem("gopinwrk@gmail.com")).toBeNull();
    expect(emailProblem("karthikeyan@theaitel.com")).toBeNull();
    expect(emailProblem("srundme@gmail.com")).toBeNull();
    expect(emailProblem("priya.nair92@yahoo.com")).toBeNull();
  });
});

describe("proof from completed homes", () => {
  it("matches only the same property", async () => {
    const { parseCompletedProjects, completedInProperty } = await import("../src/index");
    const done = parseCompletedProjects("Adarsh Palm Retreat | Bellandur | 4 BHK villa | https://www.thekarighars.com/apr\nPrestige Lakeside Habitat | Varthur | 3 BHK apartment |");
    expect(completedInProperty("Adarsh Palm Retreat, Bellandur, Bengaluru", done)?.link).toBe("https://www.thekarighars.com/apr");
    expect(completedInProperty("prestige lakeside habitat", done)?.home).toBe("3 BHK apartment");
    expect(completedInProperty("Prestige Shantiniketan", done)).toBeNull();
    expect(completedInProperty("Bellandur", done)).toBeNull();
  });
});

describe("ready for Zoho", () => {
  it("sends once name, property, home, possession and phone are in, without waiting for email", async () => {
    const { zohoReady } = await import("../src/index");
    const questions = [
      { id: "name", kind: "name" as const, label: "May I know your name?", required: true, zohoField: null },
      { id: "where", kind: "text" as const, label: "Where is the home: which area, and what is the property name?", required: true, zohoField: null },
      { id: "home", kind: "text" as const, label: "What kind of home is it: apartment, villa or independent house, and how many BHK?", required: true, zohoField: null },
      { id: "when", kind: "text" as const, label: "When do you get possession, or is the home already ready?", required: true, zohoField: null },
      { id: "phone", kind: "phone" as const, label: "Which number should the team call you on?", required: true, zohoField: "Phone" },
      { id: "email", kind: "text" as const, label: "Email for the team to share the details?", required: true, zohoField: "Email" },
    ];
    const answers = { where: "Concorde Manhattans, Electronic City", home: "4 BHK Apartment", when: "I have the keys now" };
    expect(zohoReady({ questions, answers, name: "Gopi N", phoneE164: null })).toBe(false);
    expect(zohoReady({ questions, answers, name: "Gopi N", phoneE164: "+919845011111" })).toBe(true);
  });
});

describe("an area is not a property", () => {
  it("spots an area without a property, and a builder misspelt", async () => {
    const { areaOnly, builderOnly } = await import("../src/index");
    expect(areaOnly("My apartment is in Electronic City Banglore")).toBe("Electronic City");
    expect(areaOnly("HSR Layout")).toBe("HSR Layout");
    expect(areaOnly("Whitefield")).toBe("Whitefield");
    expect(areaOnly("Sobha City")).toBeNull();
    expect(areaOnly("Prestige Falcon City")).toBeNull();
    expect(areaOnly("Concorde Manhattans")).toBeNull();
    expect(builderOnly("Concord project")).toBe("Concorde");
  });
});

describe("never commits to how long the work takes", () => {
  it("drops duration promises and keeps everything else", async () => {
    const { dropTimelinePromise, asksTimeline } = await import("../src/style");
    expect(dropTimelinePromise("A full home usually takes about 60 to 90 days. Which area is it in?")).toBe("Which area is it in?");
    expect(dropTimelinePromise("We can get it done in 6 weeks.")).toBe("");
    expect(dropTimelinePromise("Pura ghar 60 se 90 din mein ho jata hai.")).toBe("");
    expect(dropTimelinePromise("The hardware has a 10 year warranty.")).toBe("The hardware has a 10 year warranty.");
    expect(dropTimelinePromise("Got it, possession in 3 months.")).toBe("Got it, possession in 3 months.");
    expect(dropTimelinePromise("We are open 7 days a week except Monday.")).toBe("We are open 7 days a week except Monday.");
    expect(asksTimeline("how long will it take?")).toBe(true);
    expect(asksTimeline("kitna time lagega")).toBe(true);
    expect(asksTimeline("which plywood do you use?")).toBe(false);
  });
});

describe("9 Oct WhatsApp test wording", () => {
  it("drops commentary like 'that makes things easier' and speaks of our team", async () => {
    const { dropEmptyPraise, weVoice } = await import("../src/style");
    expect(dropEmptyPraise("That makes things easier sir.\nCan we reach you on this number?")).toBe("Can we reach you on this number?");
    expect(weVoice("Could you share the email for your team to forward the details?")).toBe("Could you share the email for our team to forward the details?");
  });
});

describe("no back-office narration", () => {
  it("drops 'saved your choice' lines and keeps real confirmations", async () => {
    const { dropProcessTalk } = await import("../src/style");
    expect(dropProcessTalk("Both works sir.\nI have saved your choice here so we can confirm.")).toBe("Both works sir.");
    expect(dropProcessTalk("I have noted it here for the team. Which day suits you?")).toBe("Which day suits you?");
    expect(dropProcessTalk("I have updated your number to 9845011111.")).toBe("I have updated your number to 9845011111.");
    expect(dropProcessTalk("Noted, today at 4 PM at our experience centre.")).toBe("Noted, today at 4 PM at our experience centre.");
    expect(dropProcessTalk("We have already done a 4 BHK home in Adarsh Palm Retreat.")).toBe("We have already done a 4 BHK home in Adarsh Palm Retreat.");
  });
});

describe("questions without a reason tacked on", () => {
  it("asks plainly", async () => {
    const { dropAskReason } = await import("../src/style");
    expect(dropAskReason("May I know your name so I can suggest what works best for your home?")).toBe("May I know your name?");
    expect(dropAskReason("Got it. Which area is your home in, to help you better?")).toBe("Got it. Which area is your home in?");
    expect(dropAskReason("Could you share your number so that our team can call you?")).toBe("Could you share your number?");
    expect(dropAskReason("Could you share the email for our team to forward the details?")).toBe("Could you share the email for our team to forward the details?");
    expect(dropAskReason(VISIT)).toBe(VISIT);
    expect(dropAskReason("We do villas too so we can help.")).toBe("We do villas too so we can help.");
  });
});
const VISIT = "Shall I book a free consultation for you, or would you like to visit our experience centre?";

describe("Gopi 9 Oct fixes", () => {
  it("reads pushing for a number as a question, not 'not now'", async () => {
    const { notNow } = await import("../src/situations");
    expect(notNow("Okay give a number based on the I will decide what to do")).toBe(false);
    expect(notNow("just looking for now")).toBe(true);
  });
  it("never rates a 3 BHK full home as junk on a typed area", async () => {
    const { rateLead } = await import("../src/rating");
    const questions = [
      { id: "home", kind: "text" as const, label: "What kind of home is it: apartment, villa or independent house, and how many BHK?", required: true, zohoField: null },
      { id: "area", kind: "text" as const, label: "Approximate carpet area in sq ft?", required: false, zohoField: null },
    ];
    expect(rateLead({ questions, answers: { home: "3 BHK Apartment", area: "1000 sq ft" }, hotBudgetLakhs: 30 }).rating).not.toBe("JUNK");
  });
  it("drops empty sympathy and 'we already have that'", async () => {
    const { dropEmptyPraise, dropProcessTalk } = await import("../src/style");
    expect(dropEmptyPraise("I hear you sir.\nWould you like to visit our experience centre?")).toBe("Would you like to visit our experience centre?");
    expect(dropProcessTalk("We already have that sir. Which day suits you?")).toBe("Which day suits you?");
    expect(dropProcessTalk("We have these details and will take it from here.")).toBe("");
  });
});

describe("9 Oct full-flow fixes", () => {
  it("never saves the first message as the style answer because the greeting said 'help'", async () => {
    const { absorbTranscript } = await import("../src/qualify");
    const questions = [{ id: "style", kind: "text" as const, label: "Any style you love or must-haves, like more storage or a pooja space? Reference photos help too.", required: false, zohoField: null }];
    const read = absorbTranscript({ questions, messages: [{ author: "AI", body: "Yes, this is The KariGhars. How can I help with your home?" }, { author: "PROSPECT", body: "Hi varun. I want to do interiors for my house" }], name: null, phoneE164: null, answers: {} });
    expect(read.answers.style).toBeUndefined();
  });
  it("reads 'Sorry villa' as a home correction, not a new property", async () => {
    const { preferLatestPlace } = await import("../src/sense");
    expect(preferLatestPlace("Adarsh Palm Retreat, Sarjapur Road", ["Adarsh palm retreat", "Sorry villa", "Home is ready"])).toBe("Adarsh Palm Retreat, Sarjapur Road");
    expect(preferLatestPlace("Prestige Lakeside", ["sorry, it's in Whitefield, Sobha Dream Acres"])).toBe("it's in Whitefield, Sobha Dream Acres");
  });
});

describe("no empty promises", () => {
  it("drops 'I will check that for you'", async () => {
    const { dropProcessTalk } = await import("../src/style");
    expect(dropProcessTalk("I will check that for you.\nCould you share your personal or work email?")).toBe("Could you share your personal or work email?");
  });
});
