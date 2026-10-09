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

describeDb("Gopi's 9 Oct chat, replayed", () => {
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

  it("fixes every bad reply from that afternoon", async () => {
    await seedDemo(db);
    const stamp = `${Date.now()}`;
    const workspace = await db.workspace.create({
      data: {
        name: `Gopi ${stamp}`, slug: `gopi-${stamp}`, brandName: "The KariGhars", agentName: "Varun", mode: "SIMULATION", leadQuestions: QUESTIONS,
        services: "Luxury full-home interiors in Bengaluru.", agentSettings: { workingHours: "Tuesday to Sunday, 10 AM to 7 PM" },
      },
    });
    workspaceId = workspace.id;
    const wa = await db.channelConnection.create({
      data: { workspaceId: workspace.id, channel: "WHATSAPP", mode: "SIMULATION", externalAccountId: `wa-gopi-${stamp}`, displayName: "WA", automationPaused: false },
    });
    const waId = `9189${stamp.slice(-8)}`;
    const contact = await db.contact.create({ data: { workspaceId: workspace.id, connectionId: wa.id, channel: "WHATSAPP", displayName: "Gopi Krish", chosenName: "Gopi Krishnaan" } });
    await db.contactIdentity.create({ data: { workspaceId: workspace.id, connectionId: wa.id, contactId: contact.id, channel: "WHATSAPP", identityType: "MESSAGING_PARTICIPANT", externalId: waId, evidence: "INBOUND_MESSAGE" } });
    await db.lead.create({
      data: {
        workspaceId: workspace.id, contactId: contact.id, channel: "WHATSAPP", connectionId: wa.id, activeContactKey: contact.id, sourceType: "DIRECT_MESSAGE", testRecord: true,
        phoneE164: `+${waId}`, answers: { place: "Ittina Mahaveer Apartments, Electronic City", home: "3 BHK Apartment", possession: "Next month", email: `g${stamp}@gmail.com` },
      },
    });
    const conversation = await db.conversation.create({ data: { workspaceId: workspace.id, connectionId: wa.id, contactId: contact.id, channel: "WHATSAPP", lastUserMessageAt: new Date() } });
    let at = Date.now() - 3 * 3_600_000;
    const add = (author: "AI" | "PROSPECT", body: string) => db.message.create({
      data: { workspaceId: workspace.id, connectionId: wa.id, conversationId: conversation.id, author, body, createdAt: new Date((at += 20_000)), ...(author === "PROSPECT" ? { externalMessageId: `p-${stamp}-${at}` } : {}) },
    });
    await add("PROSPECT", "Hi");
    await add("AI", "Hi sir, I am Varun, the AI assistant for The KariGhars. How can I help you with your home?");
    await add("PROSPECT", "Ittina Mahaveer Apartments, 3 BHK, possession next month");
    await add("AI", "Got it. What email should we send the details to?");

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

    // "Hi" again: a welcome back, not their details read back in Hinglish.
    const hello = await say("Hi", "Aapka 3BHK flat Ittina Mahaveer Apartments mein hai aur possession next month expected hai.");
    expect(hello).toMatch(/welcome back/i);
    expect(hello).not.toMatch(/possession next month|aapka/i);

    // Site visit and 3D: never promised.
    const visit = await say("Can someone come do a site visit at my flat to give me a 3D design?", "Sure we can arrange a site visit.");
    expect(visit).not.toMatch(/site visit/i);
    expect(visit.trim()).not.toBe("");

    // Another firm: never described.
    const rival = await say("what is the difference betwwen you and the The Decor Interiors", "We offer luxury full-home interiors while The Decor Interiors focuses on general decor.");
    expect(rival).not.toMatch(/decor interiors/i);

    // Bad reviews: the team is told.
    await say("there is lot of bad reviews", "I understand that is worrying. We will look into those reviews and address your concern directly when they speak with you.");
    expect(await db.teamAlert.count({ where: { conversationId: conversation.id, kind: "flag", text: { contains: "bad reviews" } } })).toBe(1);

    // "How do we get started?": the real next step.
    const start = await say("How do we get started ?", "Thanks. We have these details and will take it from here.");
    expect(start).toMatch(/the first step is/i);
    expect(start).not.toMatch(/take it from here/i);

    // A question before choosing is not a booking.
    await say("Before the experience center vista I want to know what materials you use", "We use Century Ply Club Prime BWP plywood in kitchens and bathrooms.");
    expect(await db.message.count({ where: { conversationId: conversation.id, author: "SYSTEM", body: { startsWith: "Offer answer: consultation" } } })).toBe(0);
    expect(await db.teamAlert.count({ where: { conversationId: conversation.id, kind: "meeting" } })).toBe(0);

    // Timeline: one line, ours.
    const timeline = await say("Okay, and I what will timeline to complete my project ?", "The schedule will vary based on your location and the extent of the work and we will lock it in once we get a clear picture of what you need.");
    expect(timeline).toMatch(/timeline depends on the site/i);
    expect(timeline).not.toMatch(/schedule will vary/i);

    // Pushing for a number is not "not now".
    // Before the fix the code itself replied "No problem sir, whenever you are ready, just message here".
    const push = await say("Okay give a number based on the I will decide what to do", "We can give you the exact numbers only after understanding your requirement in the free consultation.");
    expect(push).not.toMatch(/whenever you are ready/i);
    expect(push).toMatch(/free consultation/i);
    expect(await db.message.count({ where: { conversationId: conversation.id, author: "SYSTEM", body: { startsWith: "Situation: not-now" } } })).toBe(0);
  });
});
