/**
 * Guard risk test: thousands of model drafts run through the same text filters, in the same order, as a
 * live reply. Each scenario says what must survive (the answer, the next question) and what must never
 * reach the customer (prices, re-asks, two questions, designer talk…). Failures name the filter at fault.
 * GUARD_REPORT=/path.json writes every failure for the report.
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyReplySwitches,
  askingPrice,
  asksAboutDesign,
  dropAnsweredQuestions,
  dropCannedLines,
  dropDayAnnouncement,
  dropDeferral,
  dropDesignTalk,
  dropEchoes,
  dropEmptyPraise,
  dropIndicSentences,
  dropRepeatGreeting,
  dropUnaskedCallback,
  dropUnaskedPrice,
  easeAddress,
  hindiEndings,
  humanBubbles,
  humanizeReply,
  maleHindi,
  naturalAcknowledgement,
  questionAsked,
  weVoice,
  asksTimeline,
  dropTimelinePromise,
  TIMELINE_LINE,
} from "@snapsocial/domain";
import { beforeQuestion, oneQuestion, withoutKnownAsks } from "../src/index";

import { build, QUESTIONS, QUOTE_LINE, type Lang, type Scenario } from "./guard-scenarios";

const norm = (text: string) => text.toLowerCase().replace(/\.\.\./g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();

type Stage = { name: string; run: (text: string, scenario: Scenario) => string };
const EARLIER = ["Hi, I am Varun from The KariGhars. Which area is your home in?"];
const STAGES: Stage[] = [
  { name: "dropEchoes", run: (text, s) => dropEchoes(text, s.customer) },
  {
    name: "dropAnsweredQuestions",
    run: (text, s) => dropAnsweredQuestions(text, QUESTIONS, s.collected) || text,
  },
  { name: "dropIndicSentences", run: (text, s) => (s.lang === "en" ? dropIndicSentences(text) || text : text) },
  { name: "hindiEndings+maleHindi", run: (text, s) => (s.lang === "hinglish" ? maleHindi(hindiEndings(text)) : text) },
  { name: "dropRepeatGreeting", run: (text, s) => (s.metBefore ? dropRepeatGreeting(text) : text) },
  { name: "naturalAcknowledgement", run: (text, s) => naturalAcknowledgement(text, s.metBefore ? EARLIER : [], null) },
  { name: "humanizeReply", run: (text) => humanizeReply(text) },
  { name: "dropCannedLines", run: (text) => dropCannedLines(text) },
  { name: "dropEmptyPraise", run: (text) => dropEmptyPraise(text) },
  { name: "easeAddress+switches", run: (text, s) => applyReplySwitches(easeAddress(text, s.metBefore ? EARLIER : []), { laughter: false, emojis: false, addressSirMam: true }) },
  { name: "dropUnaskedCallback", run: (text) => dropUnaskedCallback(text, false) },
  { name: "dropUnaskedPrice+dropTimelinePromise", run: (text, s) => {
    const untimed = dropTimelinePromise(dropUnaskedPrice(text));
    return asksTimeline(s.customer) && !/timeline depends/i.test(untimed) ? beforeQuestion(untimed, TIMELINE_LINE) : untimed;
  } },
  { name: "dropDesignTalk", run: (text, s) => (asksAboutDesign(s.customer) ? text : dropDesignTalk(text) || text) },
  { name: "dropDeferral", run: (text, s) => (s.material ? dropDeferral(text) : text) },
  { name: "weVoice+dropDayAnnouncement", run: (text) => weVoice(dropDayAnnouncement(text)) },
  { name: "quoteLine", run: (text, s) => (askingPrice(s.customer) && !/exact budget/i.test(text) ? beforeQuestion(text, QUOTE_LINE) : text) },
  {
    name: "withoutKnownAsks",
    run: (text, s) => withoutKnownAsks(text, {
      nameKnown: s.collected.includes("name"),
      metBefore: s.metBefore,
      agentName: "Varun",
      askedWho: /\b(bot|ai|human)\b/i.test(s.customer),
      collected: QUESTIONS.filter((question) => s.collected.includes(question.id)),
    }),
  },
  { name: "oneQuestion", run: (text) => oneQuestion(text, QUESTIONS) },
  { name: "humanBubbles", run: (text, s) => humanBubbles(text, s.metBefore ? EARLIER : [], ["The", "KariGhars", "Varun", "BWP", "Hettich", "BHK"], { casual: true, split: true }).join("\n") },
];

type Failure = { id: number; lang: Lang; kind: string; problem: string; stage: string; customer: string; draft: string; sent: string };

function run(scenario: Scenario): Failure[] {
  const failures: Failure[] = [];
  let text = scenario.draft;
  const lostAt = new Map<string, string>();
  for (const stage of STAGES) {
    const before = text;
    text = stage.run(text, scenario);
    for (const key of scenario.mustKeep) {
      if (!lostAt.has(key) && norm(before).includes(norm(key)) && !norm(text).includes(norm(key))) lostAt.set(key, stage.name);
    }
  }
  const base = { id: scenario.id, lang: scenario.lang, kind: scenario.kind, customer: scenario.customer, draft: scenario.draft, sent: text };
  for (const key of scenario.mustKeep) {
    if (!norm(text).includes(norm(key))) failures.push({ ...base, problem: `cut good content: "${key}"`, stage: lostAt.get(key) ?? "never in draft" });
  }
  for (const bad of scenario.mustDrop) {
    if (bad.re.test(text)) failures.push({ ...base, problem: `let through: ${bad.name}`, stage: "-" });
  }
  const asks = text.split(/\n+/).flatMap((line) => line.split(/(?<=[?])\s+/)).filter((part) => part.includes("?"));
  const detail = (ask: string) => QUESTIONS.find((question) => questionAsked(question, ask))?.id ?? ask;
  // "…? And what is the property name?" is one question in two parts.
  const distinct = new Set(asks.filter((ask) => !/^(?:and|also|or|aur)\b/i.test(ask.trim())).map(detail)).size;
  if (distinct > 1) failures.push({ ...base, problem: `${distinct} questions sent`, stage: "-" });
  const lastAsk = text.lastIndexOf("?");
  for (const answer of ["timeline depends", "exact budget"]) if (lastAsk >= 0 && text.toLowerCase().indexOf(answer) > lastAsk) failures.push({ ...base, problem: "answer after the question", stage: "-" });
  if (!text.trim()) failures.push({ ...base, problem: "empty reply", stage: "-" });
  for (const id of scenario.collected) {
    const question = QUESTIONS.find((item) => item.id === id)!;
    if (id !== "name" && asks.some((ask) => questionAsked(question, ask))) failures.push({ ...base, problem: `re-asked collected: ${id}`, stage: "-" });
  }
  return failures;
}

describe("guard risk: 1700 generated drafts through the reply filters", () => {
  it("keeps every good answer and question and lets nothing bad through", () => {
    const scenarios = build(1700);
    const failures = scenarios.flatMap(run);
    const byProblem = new Map<string, number>();
    for (const failure of failures) {
      const key = `${failure.problem.replace(/".*"/, '"…"').replace(/: \S+$/, "")} @ ${failure.stage}`;
      byProblem.set(key, (byProblem.get(key) ?? 0) + 1);
    }
    const failedScenarios = new Set(failures.map((failure) => failure.id)).size;
    if (process.env.GUARD_REPORT) {
      writeFileSync(process.env.GUARD_REPORT, JSON.stringify({ total: scenarios.length, failedScenarios, byProblem: Object.fromEntries([...byProblem].sort((a, b) => b[1] - a[1])), failures }, null, 1));
    }
    console.log(`guard risk: ${scenarios.length} scenarios, ${failedScenarios} failed`);
    for (const [key, count] of [...byProblem].sort((a, b) => b[1] - a[1])) console.log(`  ${count} × ${key}`);
    expect(failures.slice(0, 5)).toEqual([]);
  });
});
