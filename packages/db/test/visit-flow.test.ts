/**
 * Replays the 9 Oct WhatsApp test: a customer answering fast is not a flood, "Both" is a visit and gets
 * the day-and-time question, and a time inside working hours is noted with how it gets confirmed.
 */
import { afterAll, describe, expect, it } from "vitest";
import { normalizeMetaPayload } from "@snapsocial/domain";
import { fixtureLlm } from "@snapsocial/integrations";
import { createPrisma } from "../src/client";
import { ingestEvents, processAvailableJobs, seedDemo, simulationRuntime, type Runtime } from "../src/index";
import { QUESTIONS } from "./guard-scenarios";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb("visit flow after the consultation offer", () => {
  const db = createPrisma(databaseUrl ?? "postgresql://unused");
  // Jobs are scheduled in real time, so the test clock starts now and only moves forward.
  let clock = new Date();
  // Tomorrow at 4 PM, unless tomorrow is the Monday off: then Tuesday.
  const tomorrow = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "long" }).format(new Date(Date.now() + 86_400_000));
  const slotDay = tomorrow === "Monday" ? "Tuesday" : "tomorrow";
  let draft = "";
  let workspaceId = "";
  const base = simulationRuntime();
  const runtime: Runtime = {
    ...base,
    now: () => clock,
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
      const pending = await db.outboxJob.count({ where: { status: "PENDING", workspaceId: workspaceId } });
      if (pending === 0) return;
      // The test clock is fixed; let it pass the short reply delay.
      clock = new Date(clock.getTime() + 15_000);
      await processAvailableJobs(db, runtime, 30);
    }
  }

  it("keeps talking to a fast customer, asks the time after 'Both', and says how the slot is confirmed", async () => {
    await seedDemo(db);
    const stamp = `${Date.now()}`;
    const workspace = await db.workspace.create({
      data: {
        name: `Visit ${stamp}`, slug: `visit-${stamp}`, brandName: "The KariGhars", agentName: "Varun", mode: "SIMULATION", leadQuestions: QUESTIONS,
        services: "Luxury full-home interiors in Bengaluru.", agentSettings: { workingHours: "Tuesday to Sunday, 10 AM to 7 PM" },
      },
    });
    workspaceId = workspace.id;
    const wa = await db.channelConnection.create({
      data: { workspaceId: workspace.id, channel: "WHATSAPP", mode: "SIMULATION", externalAccountId: `wa-visit-${stamp}`, displayName: "WA", automationPaused: false },
    });
    const waId = `9198${stamp.slice(-8)}`;
    const contact = await db.contact.create({ data: { workspaceId: workspace.id, connectionId: wa.id, channel: "WHATSAPP", displayName: "Karthikeyan", chosenName: "Karthik" } });
    await db.contactIdentity.create({ data: { workspaceId: workspace.id, connectionId: wa.id, contactId: contact.id, channel: "WHATSAPP", identityType: "MESSAGING_PARTICIPANT", externalId: waId, evidence: "INBOUND_MESSAGE" } });
    await db.lead.create({
      data: {
        workspaceId: workspace.id, contactId: contact.id, channel: "WHATSAPP", connectionId: wa.id, activeContactKey: contact.id, sourceType: "DIRECT_MESSAGE", testRecord: true,
        phoneE164: `+${waId}`, answers: { place: "Adarsh Palm Retreat, Sarjapur Road", home: "3 BHK villa", possession: "Fully finished", email: `k${stamp}@theaitel.com` },
      },
    });
    const conversation = await db.conversation.create({ data: { workspaceId: workspace.id, connectionId: wa.id, contactId: contact.id, channel: "WHATSAPP", lastUserMessageAt: clock } });
    // Twelve quick answers in the last ten minutes, each answered by Varun.
    let at = clock.getTime() - 9 * 60_000;
    const add = (author: "AI" | "PROSPECT", body: string) => db.message.create({
      data: { workspaceId: workspace.id, connectionId: wa.id, conversationId: conversation.id, author, body, createdAt: new Date((at += 20_000)), ...(author === "PROSPECT" ? { externalMessageId: `p-${stamp}-${at}` } : {}) },
    });
    for (const [said, reply] of [
      ["Hello is this kharighars", "Yes, this is The KariGhars. I am Varun, the AI assistant. How can I help with your home?"],
      ["I want to do interior for my house", "May I know your name?"],
      ["Im karthik", "Which area is your home in, and what is the property name?"],
      ["Adarsh palm retreat", "How many BHK is it?"],
      ["3", "When do you get possession, or is the home already ready?"],
      ["Fully finished sir", "Can we reach you on this same WhatsApp number?"],
      ["Yes sir you can call", "What email should we send the details to?"],
      [`k${stamp}@theaitel.com`, "Shall I book a free consultation for you, or would you like to visit our experience centre?"],
    ] as const) {
      await add("PROSPECT", said);
      await add("AI", reply);
    }
    for (const filler of ["ok", "sure", "fine", "great", "ok sir", "yes", "noted"]) await add("PROSPECT", filler);
    await add("AI", "Shall I book a free consultation for you, or would you like to visit our experience centre?");

    const say = async (text: string, reply: string) => {
      clock = new Date(clock.getTime() + 30_000);
      at = clock.getTime() - 1;
      draft = reply;
      const before = new Set((await db.message.findMany({ where: { conversationId: conversation.id, author: "AI" }, select: { id: true } })).map((message) => message.id));
      const events = normalizeMetaPayload("WHATSAPP", {
        object: "whatsapp_business_account",
        entry: [{ id: `waba-${stamp}`, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "919000000001", phone_number_id: wa.externalAccountId }, contacts: [{ profile: { name: "Karthikeyan" }, wa_id: waId }], messages: [{ from: waId, id: `wamid.${stamp}.${clock.getTime()}`, timestamp: String(Math.floor(clock.getTime() / 1000)), type: "text", text: { body: text } }] } }] }],
      }, clock);
      await ingestEvents(db, { channel: "WHATSAPP", mode: "SIMULATION", events, receivedAt: clock });
      await drain();
      return (await db.message.findMany({ where: { conversationId: conversation.id, author: "AI" }, orderBy: { createdAt: "asc" } }))
        .filter((message) => !before.has(message.id)).map((message) => message.body).join("\n");
    };

    const both = await say("Both", "Both works sir. I have saved your choice here so we can confirm.");
    expect(both).toMatch(/which day and time would you like to visit\?/i);
    expect(await db.message.count({ where: { conversationId: conversation.id, author: "SYSTEM", body: { startsWith: "Situation: flood" } } })).toBe(0);

    const slot = await say(`I want ${slotDay} 4 pm`, `Ok sir 4 PM ${slotDay} works. We will confirm.`);
    expect(slot).toMatch(new RegExp(`noted,? ${slotDay} at 4 PM at our experience centre`, "i"));
    expect(slot).toMatch(/our team will call you on \+\d+ to confirm it/i);
    expect(slot).not.toMatch(/\bworks\b/i);
  });
});
