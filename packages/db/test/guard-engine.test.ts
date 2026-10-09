/**
 * Guard risk, full engine: 300 scenarios run through the real reply pipeline (memory, next detail, every
 * filter, bubbles) with the model's draft scripted. Checks what Varun actually sends.
 * GUARD_REPORT_ENGINE=/path.json writes every failure for the report.
 */
import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { normalizeMetaPayload, questionAsked } from "@snapsocial/domain";
import { fixtureLlm } from "@snapsocial/integrations";
import { createPrisma } from "../src/client";
import { ingestEvents, processAvailableJobs, seedDemo, simulationRuntime, type Runtime } from "../src/index";
import { build, QUESTIONS, type Scenario } from "./guard-scenarios";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const VALUES: Record<string, string> = {
  place: "Prestige Lakeside Habitat, Whitefield",
  home: "4 BHK apartment",
  possession: "home is ready",
  email: "priya@gmail.com",
};
const ASKED: Record<string, string> = {
  name: "May I know your name?",
  place: "Which area is your home in, and what is the property name?",
  home: "Is it an apartment, villa or independent house, and how many BHK?",
  possession: "When do you get possession, or is the home already ready?",
  phone: "Which number should we call you on?",
  email: "What email should we send the details to?",
};
const SAID: Record<string, string> = { name: "Priya", place: VALUES.place!, home: VALUES.home!, possession: VALUES.possession!, phone: "9845011111", email: VALUES.email! };

describeDb("guard risk: 300 scenarios through the full engine", () => {
  const db = createPrisma(databaseUrl ?? "postgresql://unused");
  let draft = "";
  const base = simulationRuntime();
  const runtime: Runtime = {
    ...base,
    llm: {
      ...fixtureLlm(),
      async generate() {
        return { output: { reply: draft, field_updates: [], handoff_requested: false, handoff_reason: null }, model: "scripted", latencyMs: 0, simulated: true, diagnostics: {} };
      },
    },
  };

  afterAll(async () => {
    await db.$disconnect();
  });

  async function drain() {
    for (let index = 0; index < 10; index += 1) {
      const pending = await db.outboxJob.count({ where: { status: "PENDING", availableAt: { lte: new Date() } } });
      if (pending === 0) return;
      await processAvailableJobs(db, runtime, 30);
    }
  }

  it("sends replies that keep the answer and the next question, and nothing bad", async () => {
    await seedDemo(db);
    const stamp = `${Date.now()}`;
    const workspace = await db.workspace.create({
      data: { name: `Guard ${stamp}`, slug: `guard-${stamp}`, brandName: "The KariGhars", agentName: "Varun", mode: "SIMULATION", leadQuestions: QUESTIONS, services: "Luxury full-home interiors in Bengaluru." },
    });
    const ig = await db.channelConnection.create({
      data: { workspaceId: workspace.id, channel: "INSTAGRAM", mode: "SIMULATION", externalAccountId: `ig-guard-${stamp}`, displayName: "IG", automationPaused: false },
    });
    // English scenarios: the engine's language handling is covered by its own tests.
    const scenarios = build(2600).filter((scenario) => scenario.lang === "en").slice(0, 300)
      .filter((scenario) => !process.env.GUARD_ONLY || process.env.GUARD_ONLY.split(",").includes(String(scenario.id)));
    const failures: Array<{ id: number; kind: string; problem: string; customer: string; draft: string; sent: string }> = [];
    const results: Array<{ id: number; customer: string; draft: string; sent: string }> = [];

    for (const scenario of scenarios) {
      const sender = `igsid-guard-${stamp}-${scenario.id}`;
      const contact = await db.contact.create({
        data: { workspaceId: workspace.id, connectionId: ig.id, channel: "INSTAGRAM", username: `x_${scenario.id}_77`, chosenName: scenario.collected.includes("name") ? "Priya" : null },
      });
      await db.contactIdentity.create({ data: { workspaceId: workspace.id, connectionId: ig.id, contactId: contact.id, channel: "INSTAGRAM", identityType: "MESSAGING_PARTICIPANT", externalId: sender, evidence: "INBOUND_MESSAGE" } });
      // Each scenario is its own person: a shared phone or email would join them across chats.
      const phone = `98${String(4500000 + scenario.id * 7).padStart(8, "0")}`;
      const email = `guest${scenario.id}.${stamp}@gmail.com`;
      const own: Record<string, string> = { ...VALUES, email };
      const said: Record<string, string> = { ...SAID, phone, email };
      const answers = Object.fromEntries(scenario.collected.filter((id) => own[id]).map((id) => [id, own[id]!]));
      await db.lead.create({
        data: {
          workspaceId: workspace.id, contactId: contact.id, channel: "INSTAGRAM", connectionId: ig.id, activeContactKey: contact.id, sourceType: "DIRECT_MESSAGE", testRecord: true,
          answers, phoneE164: scenario.collected.includes("phone") ? `+91${phone}` : null,
        },
      });
      // The chat so far: Varun introduced himself and asked each collected detail, and they answered.
      if (scenario.metBefore) {
        const conversation = await db.conversation.create({ data: { workspaceId: workspace.id, connectionId: ig.id, contactId: contact.id, channel: "INSTAGRAM", lastUserMessageAt: new Date(Date.now() - 60_000) } });
        let at = Date.now() - 30 * 60_000;
        const add = (author: "AI" | "PROSPECT", body: string) => db.message.create({
          data: { workspaceId: workspace.id, connectionId: ig.id, conversationId: conversation.id, author, body, createdAt: new Date((at += 20_000)), ...(author === "PROSPECT" ? { externalMessageId: `p-${sender}-${at}` } : {}) },
        });
        await add("PROSPECT", "Hi, I need interiors for my home");
        await add("AI", "Hi, I am Varun, the AI assistant for The KariGhars.");
        for (const id of scenario.collected) {
          await add("AI", ASKED[id]!);
          await add("PROSPECT", said[id]!);
        }
      }
      draft = scenario.draft;
      const at = new Date();
      const events = normalizeMetaPayload("INSTAGRAM", { object: "instagram", entry: [{ id: ig.externalAccountId, messaging: [{ sender: { id: sender }, recipient: { id: ig.externalAccountId }, timestamp: at.getTime(), message: { mid: `mid-${sender}`, text: scenario.customer } }] }] }, at);
      await ingestEvents(db, { channel: "INSTAGRAM", mode: "SIMULATION", events, receivedAt: at });
      await drain();
      const sent = (await db.message.findMany({ where: { conversation: { contactId: contact.id }, author: "AI", createdAt: { gte: at } }, orderBy: { createdAt: "asc" } }))
        .map((message) => message.body).join("\n");
      results.push({ id: scenario.id, customer: scenario.customer, draft: scenario.draft, sent });
      failures.push(...check(scenario, sent));
    }

    const byProblem = new Map<string, number>();
    for (const failure of failures) byProblem.set(failure.problem.replace(/".*"/, '"…"'), (byProblem.get(failure.problem.replace(/".*"/, '"…"')) ?? 0) + 1);
    const failed = new Set(failures.map((failure) => failure.id)).size;
    if (process.env.GUARD_REPORT_ENGINE) {
      writeFileSync(process.env.GUARD_REPORT_ENGINE, JSON.stringify({ total: scenarios.length, failedScenarios: failed, byProblem: Object.fromEntries([...byProblem].sort((a, b) => b[1] - a[1])), failures, results }, null, 1));
    }
    console.log(`guard engine: ${scenarios.length} scenarios, ${failed} failed`);
    for (const [key, count] of [...byProblem].sort((a, b) => b[1] - a[1])) console.log(`  ${count} × ${key}`);
    expect(failures.slice(0, 5)).toEqual([]);
  }, 600_000);
});

const norm = (text: string) => text.toLowerCase().replace(/\.\.\./g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();

function check(scenario: Scenario, sent: string) {
  const base = { id: scenario.id, kind: scenario.kind, customer: scenario.customer, draft: scenario.draft, sent };
  const out: Array<typeof base & { problem: string }> = [];
  if (!sent.trim()) return [{ ...base, problem: "no reply sent" }];
  const codeCheck = /\b(did you mean|which property is it|which [a-z ]+ property is it|is yours an? [a-z ]+ there or|just to confirm|not a real home|have we spoken before)\b/i.test(sent);
  // A detail they just gave in their question ("price for 3bhk") is answered, so its question rightly goes.
  const justGiven = (key: string) => /bhk/i.test(key) && /\d\s*bhk/i.test(scenario.customer);
  for (const key of scenario.mustKeep) {
    if (norm(sent).includes(norm(key))) continue;
    // The code may ask the same detail in its own words ("May I know your name?" for "What should I call you?").
    const nextQuestion = QUESTIONS.find((question) => question.id === scenario.next);
    const asksSameDetail = Boolean(nextQuestion) && sent.split(/\n+/).some((line) => (nextQuestion!.kind === "name" ? /\byour name\b|\bcall you\b/i.test(line) : questionAsked(nextQuestion!, line)) && line.includes("?"));
    if (key === scenario.mustKeep[0] && (codeCheck || justGiven(key) || asksSameDetail)) continue;
    out.push({ ...base, problem: `cut good content: "${key}"` });
  }
  for (const bad of scenario.mustDrop) if (bad.re.test(sent)) out.push({ ...base, problem: `let through: ${bad.name}` });
  const asks = sent.split(/\n+/).flatMap((line) => line.split(/(?<=[?])\s*/)).filter((part) => part.includes("?"));
  const detail = (ask: string) => QUESTIONS.find((question) => questionAsked(question, ask))?.id ?? ask;
  if (new Set(asks.filter((ask) => !/^(?:and|also|or|aur)\b/i.test(ask.trim())).map(detail)).size > 1) out.push({ ...base, problem: "more than one question" });
  for (const id of scenario.collected) {
    const question = QUESTIONS.find((item) => item.id === id)!;
    if (asks.some((ask) => (id === "name" ? /\byour (?:good )?name\b|\bwhat should i call you\b/i.test(ask) : questionAsked(question, ask)))) out.push({ ...base, problem: `re-asked collected: ${id}` });
  }
  const lastAsk = sent.lastIndexOf("?");
  for (const answer of ["timeline depends", "exact budget"]) if (lastAsk >= 0 && sent.toLowerCase().indexOf(answer) > lastAsk) out.push({ ...base, problem: "answer after the question" });
  if (/\b(lakh|crore|starts? from)\b|₹/i.test(sent)) out.push({ ...base, problem: "price sent" });
  return out;
}
