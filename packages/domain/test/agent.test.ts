import { describe, expect, it } from "vitest";
import {
  acceptExtractedAnswers,
  applyReplySwitches,
  customerComplaint,
  dropIndicSentences,
  hasIndicSentence,
  humanBubbles,
  withAutomationDisclosure,
  parseAgentSettings,
  parseFollowUpHours,
  parseLeadQuestions,
  rupeesIn,
  salesBriefing,
  screenLead,
  unrealisticAnswers,
} from "../src/index";

describe("English chats stay English", () => {
  it("drops Tanglish sentences from a reply in an English chat", () => {
    expect(dropIndicSentences("haan sir send panni paarunga\ndesign ideas ku help aagum")).toBe("");
    expect(dropIndicSentences("No problem sir. Unga details ellam already team ku pochu.\nWhat time works for you?")).toBe("No problem sir.\nWhat time works for you?");
    expect(dropIndicSentences("Sure sir, a 3 BHK in Madiwala is more than enough space for a modular kitchen.")).toContain("Madiwala");
    expect(hasIndicSentence("haan sir wardrobe la marble finish irukku. side la laundry basket irukku.")).toBe(true);
    expect(hasIndicSentence("Nice sir, that wardrobe has a marble look finish.")).toBe(false);
  });
});

describe("home size answers", () => {
  it("keeps BHK with the number", () => {
    const questions = parseLeadQuestions([{ id: "home", label: "What kind of home is it and how many BHK?", field: "Description" }]);
    const read = acceptExtractedAnswers({ questions, raw: { home: "3" }, prospectText: "how much for 3bhk interiors?" });
    expect(read.answers.home).toBe("3 BHK");
  });
});

describe("complaints and disclosure", () => {
  it("spots an existing customer's complaint but not a new enquiry", () => {
    expect(customerComplaint("my project with you is delayed by 3 months and nobody is responding")).toBe(true);
    expect(customerComplaint("there is a leak issue in our kitchen sink cabinet")).toBe(true);
    expect(customerComplaint("I want a refund")).toBe(true);
    expect(customerComplaint("my flat is in HSR layout, need full home interiors")).toBe(false);
    expect(customerComplaint("how much for 3bhk interiors?")).toBe(false);
  });

  it("opens the first WhatsApp reply with who is talking", () => {
    expect(withAutomationDisclosure("hi sir glad u liked the kitchen", "The KariGhars", "Varun"))
      .toBe("Hi, this is Varun, an automated assistant for The KariGhars.\n\nglad u liked the kitchen");
    expect(withAutomationDisclosure("hi sir", "The KariGhars", "Varun")).toBe("Hi, this is Varun, an automated assistant for The KariGhars.");
  });
});

describe("agent settings", () => {
  it("keeps today's behaviour when nothing is set and clamps what staff type", () => {
    const defaults = parseAgentSettings(null);
    expect(defaults.voiceReplies && defaults.laughter && defaults.casualTexting).toBe(true);
    expect(defaults.followUps).toBe(false);
    const set = parseAgentSettings({ laughter: false, rules: "x".repeat(9000), followUpHours: [0, 3, 30, 20, 3], voiceReplies: "yes" });
    expect(set.laughter).toBe(false);
    expect(set.voiceReplies).toBe(true);
    expect(set.rules.length).toBe(6000);
    expect(set.followUpHours).toEqual([3, 20]);
    expect(parseFollowUpHours("2, 6 , 22")).toEqual([2, 6, 22]);
  });

  it("removes laughter, emojis and sir in code when they are switched off", () => {
    const off = { laughter: false, emojis: false, addressSirMam: false };
    expect(applyReplySwitches("Haha 2 am sir? thats too late 😅\nPick a daytime slot sir", off)).toBe("2 am? thats too late\nPick a daytime slot");
    expect(applyReplySwitches("haha ok", { laughter: true, emojis: true, addressSirMam: true })).toBe("haha ok");
  });

  it("can send one clean message instead of casual split ones", () => {
    const text = "Sure, the team handles design and execution together. Which area is your flat in?";
    expect(humanBubbles(text, [], [], { casual: false, split: false })).toEqual([text]);
    const casual = humanBubbles(text, []);
    expect(casual.join(" ")).not.toContain(",");
  });
});

describe("interiors common sense", () => {
  it("reads Indian amounts", () => {
    expect(rupeesIn("35 lakh")).toBe(3_500_000);
    expect(rupeesIn("1.2 cr")).toBe(12_000_000);
    expect(rupeesIn("40-50 lakhs")).toBe(4_000_000);
    expect(rupeesIn("50k")).toBe(50_000);
  });

  it("flags only impossible budgets and areas, not merely high or low ones", () => {
    const questions = [{ id: "budget", label: "Approximate interior budget" }, { id: "area", label: "Approximate area in sq ft" }];
    expect(unrealisticAnswers(questions, { budget: "500", area: "1450" }).map((doubt) => doubt.id)).toEqual(["budget"]);
    expect(unrealisticAnswers(questions, { budget: "5 lakh", area: "2000" })).toEqual([]);
    expect(unrealisticAnswers(questions, { budget: "1000 crore", area: "500000" }).map((doubt) => doubt.id)).toEqual(["budget", "area"]);
  });
});

describe("must-have and nice-to-have questions", () => {
  const questions = parseLeadQuestions([
    { label: "May I know your name?", zohoField: "Last_Name" },
    { label: "Which area and project is the home in?" },
    { label: "Approximate interior budget", required: false },
  ]);

  it("sends the lead once every must-have is in", () => {
    const screen = screenLead({ questions, answers: { [questions[1]!.id]: "Whitefield, Prestige Lakeside" }, name: "Anil", phoneE164: null });
    expect(screen.ready).toBe(true);
    expect(screen.optional).toEqual(["Approximate interior budget"]);
  });

  it("builds the brief from the knowledge base, rules and switches, with nothing from SnapServe", () => {
    const brief = salesBriefing({
      brandName: "The KariGhars",
      agentName: "Varun",
      services: "Luxury residential interiors in Bengaluru",
      faqs: [],
      teamNotes: null,
      questions,
      recorded: [],
      nextDetail: questions[1]!,
      ready: false,
      cold: false,
      minutesSinceSent: null,
      memoryLines: [],
      languageLine: "This chat is in English.",
      activePost: null,
      otherPosts: "- Instagram post: Walk-in wardrobe | the picture shows: a walnut walk-in wardrobe | link: https://instagram.com/p/x",
      channel: "WHATSAPP",
      knowledgeBase: "Experience centre: Tuesday to Sunday, 10 AM to 7 PM.",
      settings: parseAgentSettings({ rules: "Never promise a discount.", laughter: false, addressSirMam: false, workingHours: "Tuesday to Sunday, 10 AM to 7 PM" }),
    });
    expect(brief).toContain("Experience centre: Tuesday to Sunday");
    expect(brief).toContain("- Never promise a discount.");
    expect(brief).toContain("Never write haha");
    expect(brief).toContain("Never call them sir");
    expect(brief).toContain("Nice to have");
    expect(brief).toContain("walnut walk-in wardrobe");
    expect(brief).not.toMatch(/Tanglish|Kanglish|Hinglish|pannuvanga/);
    expect(brief).not.toMatch(/telecall|\bdemo\b|AI calling|call volume/i);
    const kannada = salesBriefing({
      brandName: "The KariGhars", agentName: "Varun", services: "", faqs: [], teamNotes: null, questions, recorded: [],
      nextDetail: questions[1]!, ready: false, cold: false, minutesSinceSent: null, memoryLines: [],
      languageLine: "This chat is in Kannada typed in English letters.", chatLanguage: "Kannada typed in English letters",
      activePost: null, otherPosts: null,
    });
    expect(kannada).toMatch(/Kanglish/);
    expect(kannada).not.toMatch(/Sollunga|pannuvanga|Batao/);
  });
});
