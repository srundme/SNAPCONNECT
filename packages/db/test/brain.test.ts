/**
 * Replays Gopi's WhatsApp afternoon on 9 Oct with the model's real drafts: each bad reply must come out fixed.
 */
import { afterAll, describe, expect, it } from "vitest";
import { normalizeMetaPayload } from "@snapsocial/domain";
import { fixtureLlm } from "@snapsocial/integrations";
import { createPrisma } from "../src/client";
import { ingestEvents, processAvailableJobs, seedDemo, simulationRuntime, type Runtime } from "../src/index";
import { QUESTIONS } from "./guard-scenarios";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb("Claude brain: facts in, words out", () => {
  const db = createPrisma(databaseUrl ?? "postgresql://unused");
  let draft = "";
  let workspaceId = "";
  const base = simulationRuntime();
  const calls: Array<{ system: string; messages: unknown[] }> = [];
  let scripted: Record<string, unknown>[] = [];
  // Runs once, while Claude is "writing": a customer message that crosses the reply.
  let whileWriting: (() => Promise<void>) | null = null;
  const runtime: Runtime = {
    ...base,
    claude: {
      model: "claude-test",
      async text() { return ""; },
      async json<T>(call: { system: unknown; messages: unknown[] }) {
        if (whileWriting) { const send = whileWriting; whileWriting = null; await send(); }
        calls.push({ system: typeof call.system === "string" ? call.system : (call.system as Array<{ text: string }>).map((block) => block.text).join("\n"), messages: call.messages });
        return (scripted.shift() ?? { bubbles: ["Thank you."], details: {}, offer_choice: null, slot: null, handoff: false, flag: null, opt_out: false }) as T;
      },
    },
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
    for (let index = 0; index < 20; index += 1) {
      const pending = await db.outboxJob.count({ where: { status: "PENDING", workspaceId } });
      if (pending === 0) return;
      await db.outboxJob.updateMany({ where: { status: "PENDING", workspaceId }, data: { availableAt: new Date() } });
      await processAvailableJobs(db, runtime, 30);
    }
  }

  it("sends Claude's words, saves checked details, and blocks rule breaks", async () => {
    await seedDemo(db);
    const stamp = `${Date.now()}`;
    const workspace = await db.workspace.create({
      data: {
        name: `Gopi ${stamp}`, slug: `brain-${stamp}`, brandName: "The KariGhars", agentName: "Varun", mode: "SIMULATION", leadQuestions: QUESTIONS,
        services: "Luxury full-home interiors in Bengaluru.", agentSettings: { workingHours: "Tuesday to Sunday, 10 AM to 7 PM" },
      },
    });
    workspaceId = workspace.id;
    const wa = await db.channelConnection.create({
      data: { workspaceId: workspace.id, channel: "WHATSAPP", mode: "SIMULATION", externalAccountId: `wa-brain-${stamp}`, displayName: "WA", automationPaused: false },
    });
    const waId = `9187${stamp.slice(-8)}`;
    const contact = await db.contact.create({ data: { workspaceId: workspace.id, connectionId: wa.id, channel: "WHATSAPP", displayName: "Gopi Krish", chosenName: "Gopi Krishnaan" } });
    await db.contactIdentity.create({ data: { workspaceId: workspace.id, connectionId: wa.id, contactId: contact.id, channel: "WHATSAPP", identityType: "MESSAGING_PARTICIPANT", externalId: waId, evidence: "INBOUND_MESSAGE" } });
    await db.lead.create({
      data: {
        workspaceId: workspace.id, contactId: contact.id, channel: "WHATSAPP", connectionId: wa.id, activeContactKey: contact.id, sourceType: "DIRECT_MESSAGE", testRecord: true,
        phoneE164: `+${waId}`, answers: {},
      },
    });
    const conversation = await db.conversation.create({ data: { workspaceId: workspace.id, connectionId: wa.id, contactId: contact.id, channel: "WHATSAPP", lastUserMessageAt: new Date() } });
    let at = Date.now() - 3 * 3_600_000;
    const add = (author: "AI" | "PROSPECT", body: string) => db.message.create({
      data: { workspaceId: workspace.id, connectionId: wa.id, conversationId: conversation.id, author, body, createdAt: new Date((at += 20_000)), ...(author === "PROSPECT" ? { externalMessageId: `p-${stamp}-${at}` } : {}) },
    });
    await add("PROSPECT", "Hi");
    await add("AI", "Hi sir, I am Varun, the AI assistant for The KariGhars. How can I help you with your home?");

    const say = async (text: string, replies: Record<string, unknown>[]) => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const now = new Date();
      scripted = replies;
      calls.length = 0;
      const before = new Set((await db.message.findMany({ where: { conversationId: conversation.id, author: "AI" }, select: { id: true } })).map((message) => message.id));
      const events = normalizeMetaPayload("WHATSAPP", {
        object: "whatsapp_business_account",
        entry: [{ id: `waba-${stamp}`, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "919000000001", phone_number_id: wa.externalAccountId }, contacts: [{ profile: { name: "Riteesh" }, wa_id: waId }], messages: [{ from: waId, id: `wamid.${stamp}.${now.getTime()}`, timestamp: String(Math.floor(now.getTime() / 1000)), type: "text", text: { body: text } }] } }] }],
      }, now);
      await ingestEvents(db, { channel: "WHATSAPP", mode: "SIMULATION", events, receivedAt: now });
      await drain();
      return (await db.message.findMany({ where: { conversationId: conversation.id, author: "AI" }, orderBy: { createdAt: "asc" } }))
        .filter((message) => !before.has(message.id)).map((message) => message.body);
    };
    const reply = (bubbles: string[], extra: Record<string, unknown> = {}) => ({ bubbles, details: {}, offer_choice: null, slot: null, handoff: false, flag: null, opt_out: false, ...extra });

    // Claude's words go out exactly as written, as separate bubbles; the prompt and facts go in.
    const first = await say("Hi, I have a 3 bhk villa in Prestige Lakeside", [reply(["Thank you for reaching out.", "When do you get possession, or is the home already ready?"], { details: { bhk: "3", home_type: "villa", property: "Prestige Lakeside" } })]);
    // Claude's words, texted like a person: no commas or full stops, the question mark kept.
    expect(first).toEqual(["Thank you for reaching out", "When do you get possession or is the home already ready?"]);
    expect(calls[0]!.system).toMatch(/You are Varun, the AI assistant of The KariGhars/);
    expect(calls[0]!.system).toMatch(/# FACTS/);
    const saved = await db.lead.findFirstOrThrow({ where: { contactId: contact.id } });
    expect(JSON.stringify(saved.answers)).toMatch(/3 BHK Villa/);
    expect(JSON.stringify(saved.answers)).toMatch(/Prestige Lakeside/);

    // A fake email is never saved, and Claude is asked again with the problem as a fact.
    const email = await say("abc@abc.com", [reply(["Got it."], { details: { email: "abc@abc.com" } }), reply(["That email does not look right. Could you share the one you use?"])]);
    expect(email).toEqual(["That email does not look right...could you share the one you use?"]);
    expect(calls[1]!.system).toMatch(/Email "abc@abc\.com" looks wrong/);
    expect(JSON.stringify((await db.lead.findFirstOrThrow({ where: { contactId: contact.id } })).answers)).not.toMatch(/abc@abc/);

    // A price in Claude's words is sent back to Claude, never to the customer.
    const price = await say("ok what is the price", [reply(["It starts from 35 lakhs."]), reply(["We will share the exact budget after understanding your requirement, the scope and the materials you choose."])]);
    expect(price.join(" ")).not.toMatch(/lakh/i);
    expect(calls[1]!.system).toMatch(/gives a price/);

    // The offer answer and slot become notes and alerts for the team.
    await say("Experience centre, tomorrow 4 pm", [reply(["Noted, tomorrow at 4 PM. Our team will call you to confirm."], { offer_choice: "experience_centre", slot: "tomorrow 4 pm" })]);
    expect(await db.teamAlert.count({ where: { conversationId: conversation.id, kind: "meeting" } })).toBe(1);
    expect(await db.teamAlert.count({ where: { conversationId: conversation.id, kind: "slot" } })).toBe(1);

    // Crossed messages: a question that arrives while Claude is writing makes that reply out of date; it is not sent,
    // and the next reply answers the new question.
    const crossAt = new Date(Date.now() + 2_000);
    whileWriting = async () => {
      const events = normalizeMetaPayload("WHATSAPP", {
        object: "whatsapp_business_account",
        entry: [{ id: `waba-${stamp}`, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "919000000001", phone_number_id: wa.externalAccountId }, contacts: [{ profile: { name: "Riteesh" }, wa_id: waId }], messages: [{ from: waId, id: `wamid.${stamp}.cross`, timestamp: String(Math.floor(crossAt.getTime() / 1000)), type: "text", text: { body: "First, what is the timeline?" } }] } }] }],
      }, crossAt);
      await ingestEvents(db, { channel: "WHATSAPP", mode: "SIMULATION", events, receivedAt: crossAt });
    };
    const crossed = await say("I have few doubts", [reply(["Sure sir, please share your doubts."]), reply(["The timeline depends on the site and the scope of work, sir."])]);
    expect(crossed.join(" ")).not.toMatch(/please share your doubts/i);
    expect(crossed.join(" ")).toMatch(/timeline depends/i);

    // Varun always has the last word: a closing "thank you" gets a reply.
    await db.lead.updateMany({ where: { contactId: contact.id }, data: { crmState: "SYNCED", qualification: "QUALIFIED" } });
    const closing = await say("Okay thank you", [reply(["You are welcome sir. Our team will be in touch tomorrow."])]);
    expect(closing.length).toBe(1);
  });
});
