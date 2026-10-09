/**
 * Replays "Adarsh palm retreat" from the 9 Oct WhatsApp test: Varun confirms where it is, says we have
 * already done a home there, never narrates saving things, and a yes keeps the property with its area.
 */
import { afterAll, describe, expect, it } from "vitest";
import { normalizeMetaPayload } from "@snapsocial/domain";
import { fixtureLlm } from "@snapsocial/integrations";
import { createPrisma } from "../src/client";
import { ingestEvents, processAvailableJobs, seedDemo, simulationRuntime, type Runtime } from "../src/index";
import { QUESTIONS } from "./guard-scenarios";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb("property check and proof", () => {
  const db = createPrisma(databaseUrl ?? "postgresql://unused");
  let draft = "";
  let workspaceId = "";
  const base = simulationRuntime();
  const runtime: Runtime = {
    ...base,
    lookupPlace: async () => ({
      name: "Adarsh Palm Retreat", locality: "Sarjapur Road", city: "Bengaluru", pincode: null, underConstruction: false, kind: "villa", bhkOptions: [2, 3], source: "Brave Search",
    }),
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

  it("confirms the location, mentions our past home there, and saves the area on yes", async () => {
    await seedDemo(db);
    await db.projectLookup.deleteMany({ where: { key: { startsWith: "adarsh palm retreat" } } });
    const stamp = `${Date.now()}`;
    const workspace = await db.workspace.create({
      data: {
        name: `Property ${stamp}`, slug: `property-${stamp}`, brandName: "The KariGhars", agentName: "Varun", mode: "SIMULATION", leadQuestions: QUESTIONS,
        services: "Luxury full-home interiors in Bengaluru.",
        agentSettings: { completedProjects: "Adarsh Palm Retreat | Sarjapur Road | 4 BHK | https://www.thekarighars.com/videos/" },
      },
    });
    workspaceId = workspace.id;
    const wa = await db.channelConnection.create({
      data: { workspaceId: workspace.id, channel: "WHATSAPP", mode: "SIMULATION", externalAccountId: `wa-prop-${stamp}`, displayName: "WA", automationPaused: false },
    });
    const waId = `9197${stamp.slice(-8)}`;
    const contact = await db.contact.create({ data: { workspaceId: workspace.id, connectionId: wa.id, channel: "WHATSAPP", displayName: "Karthikeyan", chosenName: "Karthik" } });
    await db.contactIdentity.create({ data: { workspaceId: workspace.id, connectionId: wa.id, contactId: contact.id, channel: "WHATSAPP", identityType: "MESSAGING_PARTICIPANT", externalId: waId, evidence: "INBOUND_MESSAGE" } });
    await db.lead.create({ data: { workspaceId: workspace.id, contactId: contact.id, channel: "WHATSAPP", connectionId: wa.id, activeContactKey: contact.id, sourceType: "DIRECT_MESSAGE", testRecord: true } });
    const conversation = await db.conversation.create({ data: { workspaceId: workspace.id, connectionId: wa.id, contactId: contact.id, channel: "WHATSAPP", lastUserMessageAt: new Date() } });
    let at = Date.now() - 5 * 60_000;
    const add = (author: "AI" | "PROSPECT", body: string) => db.message.create({
      data: { workspaceId: workspace.id, connectionId: wa.id, conversationId: conversation.id, author, body, createdAt: new Date((at += 20_000)), ...(author === "PROSPECT" ? { externalMessageId: `p-${stamp}-${at}` } : {}) },
    });
    await add("PROSPECT", "I want to do interior for my house");
    await add("AI", "May I know your name?");
    await add("PROSPECT", "Im karthik");
    await add("AI", "Which area is your home in, and what is the property name?");

    const say = async (text: string, reply: string) => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const now = new Date();
      draft = reply;
      const before = new Set((await db.message.findMany({ where: { conversationId: conversation.id, author: "AI" }, select: { id: true } })).map((message) => message.id));
      const events = normalizeMetaPayload("WHATSAPP", {
        object: "whatsapp_business_account",
        entry: [{ id: `waba-${stamp}`, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "919000000001", phone_number_id: wa.externalAccountId }, contacts: [{ profile: { name: "Karthikeyan" }, wa_id: waId }], messages: [{ from: waId, id: `wamid.${stamp}.${now.getTime()}`, timestamp: String(Math.floor(now.getTime() / 1000)), type: "text", text: { body: text } }] } }] }],
      }, now);
      await ingestEvents(db, { channel: "WHATSAPP", mode: "SIMULATION", events, receivedAt: now });
      await drain();
      return (await db.message.findMany({ where: { conversationId: conversation.id, author: "AI" }, orderBy: { createdAt: "asc" } }))
        .filter((message) => !before.has(message.id)).map((message) => message.body).join("\n");
    };

    const first = await say("Adarsh palm retreat", "I have saved your choice here so we can confirm. Most homes there are 2 and 3 BHK, what is the BHK of yours?");
    expect(first).toMatch(/is that Adarsh Palm Retreat on Sarjapur Road\?/i);
    expect(first).toMatch(/we have already done a 4 BHK home in Adarsh Palm Retreat/i);
    expect(first).toMatch(/thekarighars\.com\/videos/);
    expect(first).not.toMatch(/saved|so we can confirm/i);
    expect(first.split("?").length - 1).toBe(1);

    const second = await say("Yes", "Got it. How many BHK is your villa?");
    expect(second).toMatch(/how many BHK/i);
    const lead = await db.lead.findFirstOrThrow({ where: { contactId: contact.id } });
    expect(JSON.stringify(lead.answers)).toMatch(/Adarsh Palm Retreat, Sarjapur Road/);

    // "3": the listing says villas, but they have not said so. Save only the BHK and ask the type once.
    const third = await say("3", "3 BHK villa at Adarsh Palm Retreat. When do you get possession?");
    expect(third).toMatch(/is yours a villa there or a flat\?/i);
    expect(third).not.toMatch(/BHK villa/i);
    const afterBhk = await db.lead.findFirstOrThrow({ where: { contactId: contact.id } });
    expect(JSON.stringify(afterBhk.answers)).toMatch(/"3 BHK"/);
    expect(JSON.stringify(afterBhk.answers)).not.toMatch(/villa/i);

    await say("Villa", "Got it. When do you get possession, or is the home already ready?");
    const typed = await db.lead.findFirstOrThrow({ where: { contactId: contact.id } });
    expect(JSON.stringify(typed.answers)).toMatch(/3 BHK Villa/i);
  });
});
