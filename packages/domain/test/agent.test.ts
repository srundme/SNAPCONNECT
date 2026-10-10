import { describe, expect, it } from "vitest";
import {
  acceptExtractedAnswers,
  withAutomationDisclosure,
  parseAgentSettings,
  parseFollowUpHours,
  parseLeadQuestions,
  screenLead,
  openDays,
  parsePhone,
} from "../src/index";

describe("office hours", () => {
  it("knows the team's days off and holidays", () => {
    expect(openDays("Tuesday to Sunday, 10 AM to 7 PM")?.has("Monday")).toBe(false);
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
    expect(parsePhone("971502847316").kind).toBe("invalid");
    expect(parsePhone("971502847316", "IN,AE")).toMatchObject({ kind: "valid", e164: "+971502847316" });
    expect(parsePhone("9845012345", "IN,AE")).toMatchObject({ kind: "valid", e164: "+919845012345" });
    for (const indian of ["91 6383653279", "916383653279", "091 6383653279", "06383653279", "(91) 63836 53279"]) {
      expect(parsePhone(indian), indian).toMatchObject({ kind: "valid", e164: "+916383653279" });
    }
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

  it("opens the first WhatsApp reply with who is talking", () => {
    expect(withAutomationDisclosure("hi sir glad u liked the kitchen", "The KariGhars", "Varun"))
      .toBe("Hi, this is Varun, an automated assistant for The KariGhars.\n\nglad u liked the kitchen");
    expect(withAutomationDisclosure("hi sir", "The KariGhars", "Varun")).toBe("Hi, this is Varun, an automated assistant for The KariGhars.");
  });
});

describe("agent settings", () => {
  it("keeps today's behaviour when nothing is set and clamps what staff type", () => {
    const defaults = parseAgentSettings(null);
    expect(defaults.followUps).toBe(false);
    expect(parseFollowUpHours("2, 6 , 22")).toEqual([2, 6, 22]);
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
});
