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

describeDb("Riteesh small home, 9 Oct demo", () => {
  const db = createPrisma(databaseUrl ?? "postgresql://unused");
  let draft = "";
  let workspaceId = "";
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
    for (let index = 0; index < 20; index += 1) {
      const pending = await db.outboxJob.count({ where: { status: "PENDING", workspaceId } });
      if (pending === 0) return;
      await db.outboxJob.updateMany({ where: { status: "PENDING", workspaceId }, data: { availableAt: new Date() } });
      await processAvailableJobs(db, runtime, 30);
    }
  }

  it("answers a 2 BHK with the small-home check", async () => {
    await seedDemo(db);
    const stamp = `${Date.now()}`;
    const workspace = await db.workspace.create({
      data: {
        name: `Gopi ${stamp}`, slug: `small-${stamp}`, brandName: "The KariGhars", agentName: "Varun", mode: "SIMULATION", leadQuestions: QUESTIONS,
        services: "Luxury full-home interiors in Bengaluru.", agentSettings: { workingHours: "Tuesday to Sunday, 10 AM to 7 PM" },
      },
    });
    workspaceId = workspace.id;
    const wa = await db.channelConnection.create({
      data: { workspaceId: workspace.id, channel: "WHATSAPP", mode: "SIMULATION", externalAccountId: `wa-small-${stamp}`, displayName: "WA", automationPaused: false },
    });
    const waId = `9188${stamp.slice(-8)}`;
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

    const say = async (text: string, reply: string) => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const now = new Date();
      draft = reply;
      const before = new Set((await db.message.findMany({ where: { conversationId: conversation.id, author: "AI" }, select: { id: true } })).map((message) => message.id));
      const events = normalizeMetaPayload("WHATSAPP", {
        object: "whatsapp_business_account",
        entry: [{ id: `waba-${stamp}`, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "919000000001", phone_number_id: wa.externalAccountId }, contacts: [{ profile: { name: "Gopi Krish" }, wa_id: waId }], messages: [{ from: waId, id: `wamid.${stamp}.${now.getTime()}`, timestamp: String(Math.floor(now.getTime() / 1000)), type: "text", text: { body: text } }] } }] }],
      }, now);
      await ingestEvents(db, { channel: "WHATSAPP", mode: "SIMULATION", events, receivedAt: now });
      await drain();
      return (await db.message.findMany({ where: { conversationId: conversation.id, author: "AI" }, orderBy: { createdAt: "asc" } }))
        .filter((message) => !before.has(message.id)).map((message) => message.body).join("\n");
    };

    // Riteesh, 9 Oct demo: a 2 BHK gets the code's small-home check, never "How can we help you today?".
    const small = await say("I have 2 bhk property, with 10 lakhs budget", "Got it. How can we help you today?");
    expect(small).toMatch(/2 BHK/i);
    expect(small).not.toMatch(/how can we help you today/i);
  });
});
