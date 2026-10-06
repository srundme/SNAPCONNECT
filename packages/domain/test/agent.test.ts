import { describe, expect, it } from "vitest";
import {
  acceptExtractedAnswers,
  agreesToWhatsAppNumber,
  applyReplySwitches,
  askSameNumber,
  contextChecks,
  customerComplaint,
  dropAnsweredQuestions,
  dropIndicSentences,
  hasIndicSentence,
  humanBubbles,
  withAutomationDisclosure,
  dropRepeatGreeting,
  parseAgentSettings,
  parseFollowUpHours,
  parseLeadQuestions,
  rupeesIn,
  salesBriefing,
  screenLead,
  unrealisticAnswers,
  messageSituations,
  labelledAnswers,
  repeatsEarlier,
  pricePush,
  abroadSituation,
  dayOffLine,
  openDays,
  parsePhone,
  wrongPhoneIn,
  phoneProblem,
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

describe("no repeats and no re-asking", () => {
  const questions = parseLeadQuestions([
    { id: "scope", label: "Is it the full home or selected rooms?", field: "Description" },
    { id: "area", label: "Where is the home, which area and which apartment or project?", field: "Description" },
    { id: "phone", label: "Best number to reach you", field: "Phone", kind: "phone" },
  ]);

  it("drops a question about a detail they already gave, keeps the rest", () => {
    const reply = "Pricing depends on the scope and materials, so the team confirms it in the free consultation. Is it the full home or selected rooms?";
    expect(dropAnsweredQuestions(reply, questions, ["scope"])).toBe("Pricing depends on the scope and materials, so the team confirms it in the free consultation.");
    expect(dropAnsweredQuestions("Noted. Which number should the team call you on?", questions, ["phone"])).toBe("Noted.");
    expect(dropAnsweredQuestions("Noted. Which area and which apartment is it in?", [...questions, { id: "type", label: "What kind of home is it, apartment, villa or independent house?", field: "Description", kind: "text", required: true }], ["scope", "type"]))
      .toBe("Noted. Which area and which apartment is it in?");
  });

  it("keeps the honest answer to 'are you a bot' even if it was said before", () => {
    const earlier = ["hi this is Varun an automated assistant for The KariGhars"];
    expect(humanBubbles("yes sir this is Varun an automated assistant for The KariGhars. the team are real people", earlier, [], { keep: /\bautomated\b/i }).join(" ")).toMatch(/automated/);
  });

  it("does not send a question it just asked in slightly different words", () => {
    const bubbles = humanBubbles("noted sir. where is the home sir which area and project?", ["understood sir\nwhere is the home located which area and project?"]);
    expect(bubbles.join(" ")).not.toMatch(/where is the home/);
  });
});

describe("common sense checks", () => {
  const questions = [
    { id: "place", label: "Where is the home: which area and which apartment or project?" },
    { id: "type", label: "What kind of home is it: apartment, villa or independent house, and how many BHK?" },
    { id: "scope", label: "Is it the full home or selected rooms?" },
    { id: "when", label: "When do you get possession, or is the home already ready?" },
    { id: "budget", label: "Roughly what interior budget do you have in mind?" },
    { id: "size", label: "Approximate carpet area in sq ft?" },
  ];
  const now = new Date("2026-10-06T04:00:00Z");
  const keys = (answers: Record<string, string>) => contextChecks({ questions, answers, now, serviceArea: "Bengaluru, Bangalore" }).map((check) => check.key.split(":")[0]);

  it("flags a budget that cannot cover a full home, but not a fair one or a few rooms", () => {
    expect(keys({ type: "3 BHK", scope: "Full home", budget: "2 lakh" })).toEqual(["budget-scope"]);
    expect(keys({ type: "3 BHK", scope: "Full home", budget: "12 lakh" })).toEqual([]);
    expect(keys({ type: "3 BHK", scope: "only kitchen", budget: "2 lakh" })).toEqual([]);
  });

  it("flags a size that does not fit the BHK", () => {
    expect(keys({ type: "4 BHK apartment", size: "800" })).toEqual(["area-bhk"]);
    expect(keys({ type: "2 BHK", size: "1,100 sq ft" })).toEqual([]);
  });

  it("flags a possession date already gone, not a coming one or a ready home", () => {
    expect(keys({ when: "January 2024" })).toEqual(["past-date"]);
    expect(keys({ when: "March 2026" })).toEqual(["past-date"]);
    expect(keys({ when: "December 2026" })).toEqual([]);
    expect(keys({ when: "got keys in 2025, already ready" })).toEqual([]);
  });

  it("flags a home in another city, not a Bengaluru locality", () => {
    expect(keys({ place: "Anna Nagar, Chennai" })).toEqual(["outside-area"]);
    expect(keys({ place: "HSR Layout" })).toEqual([]);
    expect(keys({ place: "Whitefield, Bangalore" })).toEqual([]);
  });

  it("captures a labelled budget or size even when another question was asked", () => {
    expect(labelledAnswers(questions, "budget 8")).toEqual({ budget: "8" });
    expect(labelledAnswers(questions, "my budget is around 25 lakhs")).toEqual({ budget: "25 lakhs" });
    expect(labelledAnswers(questions, "budget evlo aagum?")).toEqual({});
    expect(labelledAnswers(questions, "carpet area 1200 sq ft")).toEqual({ size: "1200 sq ft" });
  });

  it("knows a renovation is a ready home and picks up a typed email", () => {
    const withEmail = [...questions, { id: "email", label: "Email for the team to share designs?" }];
    expect(labelledAnswers(questions, "Yes sir I want to renovate my home")).toEqual({ when: "Ready: renovating a home they already have" });
    expect(labelledAnswers(questions, "Sir Im already living on that house only")).toEqual({ when: "Ready: they already live there (renovation)" });
    expect(labelledAnswers(questions, "next month probably")).toEqual({});
    expect(labelledAnswers(withEmail, "karthikeyan@theaitel.com")).toEqual({ email: "karthikeyan@theaitel.com" });
  });

  it("spots renovation and consultation booking", () => {
    const keysOf = (text: string) => messageSituations(text, "The KariGhars").map((item) => item.key);
    expect(keysOf("I want to renovate my home")).toContain("renovation");
    expect(keysOf("Okay book me a consultation")).toContain("book-consultation");
    expect(keysOf("can we schedule a site visit on saturday")).toContain("book-consultation");
    expect(keysOf("I want to design interior for my new flat")).toEqual([]);
    expect(keysOf("No i can't come and visit jst send me everything")).toContain("wants-portfolio");
  });

  it("does not resend a reply that only repeats earlier ones", () => {
    const earlier = ["pricing depends on the home the scope and the materials so the team confirms it after understanding the requirement...may i know ur name?"];
    expect(repeatsEarlier("Pricing depends on the home, the scope and the materials, so the team confirms it after understanding the requirement in the free consultation. May I know your name?", earlier)).toBe(true);
    expect(repeatsEarlier("Godrej Splendour is a nice project. Is it the full home or selected rooms?", earlier)).toBe(false);
  });

  it("reads budget shorthand instead of treating it as a joke", () => {
    expect(keys({ type: "3 BHK", scope: "Full home", budget: "15" })).toEqual(["budget-unit"]);
    expect(unrealisticAnswers(questions, { budget: "15" })).toEqual([]);
    expect(keys({ type: "3 BHK", scope: "Full home", budget: "30k" })).toEqual(["budget-small"]);
    expect(keys({ type: "3 BHK", scope: "Full home", budget: "1.5 cr" })).toEqual(["budget-crore"]);
    expect(keys({ type: "3 BHK", budget: "2000 per sq ft" })).toEqual(["budget-rate"]);
  });

  it("understands other area units and plot sizes", () => {
    expect(keys({ type: "3 BHK", size: "120 sq m" })).toEqual(["area-unit"]);
    expect(unrealisticAnswers(questions, { size: "75 sq m" })).toEqual([]);
    expect(keys({ type: "3 BHK villa", size: "5 cents plot" })).toEqual(["area-unit"]);
    expect(keys({ type: "3 BHK", size: "1800 sq ft super built up" })).toEqual([]);
  });

  it("marks a possession date far away as early stage", () => {
    expect(keys({ when: "March 2028" })).toEqual(["far-date"]);
    expect(keys({ when: "after 2 years" })).toEqual(["far-date"]);
    expect(keys({ when: "June 2027" })).toEqual([]);
  });
});

describe("real-world situations", () => {
  const keys = (text: string) => messageSituations(text, "The KariGhars").map((item) => item.key.split(":")[0]);

  it("spots people who are not customers and hands them to staff", () => {
    expect(keys("Hi, I am a carpenter looking for work")).toEqual(["not-a-lead"]);
    expect(keys("We are manufacturers of modular kitchen hardware")).toEqual(["not-a-lead"]);
    expect(keys("any job vacancy for interior designer?")).toEqual(["not-a-lead"]);
    expect(messageSituations("Earn 5000 daily, click here", "The KariGhars")[0]?.handoff).toBeTruthy();
    expect(keys("are you single?")).toEqual(["flirt"]);
    expect(keys("need full home interiors for my 3 BHK")).toEqual([]);
    expect(keys("can you send photos of your work?")).toEqual(["wants-portfolio"]);
    expect(keys("i want to see your previous work")).toEqual(["wants-portfolio"]);
    expect(keys("how many clients have you worked with?")).toEqual(["credentials"]);
    expect(keys("can i visit the experience centre?")).toEqual([]);
  });

  it("spots small jobs, rented homes, family enquiries and someone else's number", () => {
    expect(keys("just need to fix one hinge")).toEqual(["small-job"]);
    expect(keys("we are staying on rent, need wardrobes")).toEqual(["rented-home"]);
    expect(keys("planning to rent it out after interiors")).toEqual([]);
    expect(keys("asking for my parents flat in Jayanagar")).toEqual(["for-someone"]);
    expect(keys("call my husband on 9845012345")).toEqual(["number-owner"]);
  });

  it("spots competitor quotes and rushed timelines", () => {
    expect(keys("Livspace quoted 6 lakh, can you beat that price?")).toEqual(["competitor"]);
    expect(keys("need it done before griha pravesh")).toEqual(["rush"]);
    expect(keys("possession is in December")).toEqual([]);
  });

  it("knows someone is abroad from their number or their words", () => {
    const now = new Date("2026-10-06T04:00:00Z");
    expect(abroadSituation({ phoneE164: "+971502847316", texts: [], now })?.line).toMatch(/United Arab Emirates[\s\S]*about .* there now/);
    expect(abroadSituation({ phoneE164: "+919845012345", texts: ["I'm based in London, flat is in HSR"], now })?.key).toBe("abroad:GB");
    expect(abroadSituation({ phoneE164: "+919845012345", texts: ["flat in HSR layout"], now })).toBeNull();
    expect(abroadSituation({ phoneE164: "+14155552671", texts: [], now })?.line).toMatch(/which time zone/);
  });

  it("knows the team's days off and holidays", () => {
    expect(openDays("Tuesday to Sunday, 10 AM to 7 PM")?.has("Monday")).toBe(false);
    expect(dayOffLine(new Date("2026-10-05T06:00:00Z"), "", "Tuesday to Sunday, 10 AM to 7 PM")).toMatch(/Monday.*weekly off.*Tuesday/);
    expect(dayOffLine(new Date("2026-10-02T06:00:00Z"), "", "Monday to Saturday")).toMatch(/Gandhi Jayanti/);
    expect(dayOffLine(new Date("2026-11-08T06:00:00Z"), "2026-11-08 Deepavali", "Monday to Saturday")).toMatch(/Deepavali/);
    expect(dayOffLine(new Date("2026-10-06T06:00:00Z"), "", "Tuesday to Sunday, 10 AM to 7 PM")).toBe("");
  });
});

describe("international numbers", () => {
  it("accepts real foreign numbers and rejects made-up ones the same way as Indian ones", () => {
    expect(parsePhone("+971 50 284 7316").kind).toBe("valid");
    expect(parsePhone("00971 50 284 7316").kind).toBe("valid");
    expect(parsePhone("+44 7911 283946").kind).toBe("valid");
    expect(parsePhone("+971 55 555 5555").kind).toBe("invalid");
    expect(parsePhone("+971 50 123 4567").kind).toBe("invalid");
    expect(parsePhone("+971 50 123").kind).toBe("invalid");
    expect(wrongPhoneIn("my number +971 50 123", "IN", 6)).toBe("+97150123");
    expect(phoneProblem("+97150123")).toMatch(/country code/);
    expect(parsePhone("971502847316").kind).toBe("invalid");
    expect(parsePhone("971502847316", "IN,AE")).toMatchObject({ kind: "valid", e164: "+971502847316" });
    expect(parsePhone("9845012345", "IN,AE")).toMatchObject({ kind: "valid", e164: "+919845012345" });
    expect(pricePush(["how much for 3bhk?", "just tell me approx"])?.key).toBe("price-push");
    expect(pricePush(["how much for 3bhk?", "ok 3bhk in HSR"])).toBeNull();
    for (const indian of ["91 6383653279", "916383653279", "091 6383653279", "06383653279", "(91) 63836 53279"]) {
      expect(parsePhone(indian), indian).toMatchObject({ kind: "valid", e164: "+916383653279" });
    }
    expect(phoneProblem("971501234567")).toMatch(/country code/);
  });
});

describe("WhatsApp number", () => {
  it("asks to use the same WhatsApp number instead of which number, once", () => {
    expect(askSameNumber("ok sir already with u makes things easier. Which number should the team call u on?", "+916383653279"))
      .toBe("ok sir already with u makes things easier. Shall the team call you on this same WhatsApp number, +916383653279?");
    expect(askSameNumber("Can I call on this WhatsApp number? Which number should we use?", "+916383653279")).toBe("Can I call on this WhatsApp number?");
    const mentions = "sir I get that a number upfront would be easier but every project is different, may I know your name";
    expect(askSameNumber(mentions, "+916383653279")).toBe(mentions);
    expect(askSameNumber("May I know your contact number?", "+916383653279")).toMatch(/same WhatsApp number/);
  });

  it("knows when they agreed to the same number", () => {
    const asked = "Shall the team call you on this same WhatsApp number, +916383653279?";
    expect(agreesToWhatsAppNumber("yes", asked)).toBe(true);
    expect(agreesToWhatsAppNumber("ok call me", asked)).toBe(true);
    expect(agreesToWhatsAppNumber("Same number", "anything")).toBe(true);
    expect(agreesToWhatsAppNumber("no call 9876501234 instead", asked)).toBe(false);
    expect(agreesToWhatsAppNumber("yes", "Is it the full home or selected rooms?")).toBe(false);
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

  it("does not greet again later in the chat", () => {
    expect(dropRepeatGreeting("hi Ravi sir\n4 BHK in Whitefield, nice")).toBe("4 BHK in Whitefield, nice");
    expect(dropRepeatGreeting("Hi Meena, which area is the flat in?")).toBe("which area is the flat in?");
    expect(dropRepeatGreeting("hi Meena mam thanks for that")).toBe("thanks for that");
    expect(dropRepeatGreeting("Hi Ravi sir. Noted the area")).toBe("Noted the area");
    expect(dropRepeatGreeting("hi sir")).toBe("hi sir");
    expect(dropRepeatGreeting("Highly recommend laminate for kids rooms")).toBe("Highly recommend laminate for kids rooms");
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
    expect(brief).toContain("# Your expertise");
    expect(brief).not.toContain("Design notes from the team");
    const designer = salesBriefing({
      brandName: "The KariGhars", agentName: "Varun", services: "", faqs: [], teamNotes: null, questions, recorded: [],
      nextDetail: questions[1]!, ready: false, cold: false, minutesSinceSent: null, memoryLines: [],
      languageLine: "This chat is in English.", activePost: null, otherPosts: null,
      settings: parseAgentSettings({ designKnowledge: "Parallel kitchens suit long narrow spaces." }),
    });
    expect(designer).toContain("Design notes from the team");
    expect(designer).toContain("Parallel kitchens suit long narrow spaces.");
    expect(kannada).toMatch(/Kanglish/);
    expect(kannada).not.toMatch(/Sollunga|pannuvanga|Batao/);
  });
});
