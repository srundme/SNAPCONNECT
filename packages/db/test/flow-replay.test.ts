/**
 * Replays the full 9 Oct WhatsApp test: basics, then straight to the visit offer, the property never lost,
 * and the consultation time asked properly.
 */
import { afterAll, describe, expect, it } from "vitest";
import { normalizeMetaPayload } from "@snapsocial/domain";
import { fixtureLlm } from "@snapsocial/integrations";
import { createPrisma } from "../src/client";
import { ingestEvents, processAvailableJobs, seedDemo, simulationRuntime, type Runtime } from "../src/index";
import { QUESTIONS } from "./guard-scenarios";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb("full chat flow, 9 Oct test", () => {
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

  it("goes from the basics straight to the visit offer, keeps the property, and books the time", async () => {
    await seedDemo(db);
    await db.projectLookup.deleteMany({ where: { key: { startsWith: "adarsh palm retreat" } } });
    const stamp = `${Date.now()}`;
    const workspace = await db.workspace.create({
      data: {
        name: `Flow ${stamp}`, slug: `flow-${stamp}`, brandName: "The KariGhars", agentName: "Varun", mode: "SIMULATION",
        leadQuestions: [
          ...QUESTIONS,
          { id: "style", kind: "text", label: "Any style you love or must-haves, like more storage or a pooja space? Reference photos help too.", required: false, zohoField: null },
          { id: "carpet", kind: "text", label: "Approximate carpet area in sq ft?", required: false, zohoField: null },
          { id: "timeline", kind: "text", label: "When would you like the work to start or finish?", required: false, zohoField: null },
        ],
        services: "Luxury full-home interiors in Bengaluru.",
        agentSettings: { workingHours: "Tuesday to Sunday, 10 AM to 7 PM", completedProjects: "Adarsh Palm Retreat | Sarjapur Road | 4 BHK | https://www.thekarighars.com/videos/" },
      },
    });
    workspaceId = workspace.id;
    const wa = await db.channelConnection.create({
      data: { workspaceId: workspace.id, channel: "WHATSAPP", mode: "SIMULATION", externalAccountId: `wa-flow-${stamp}`, displayName: "WA", automationPaused: false },
    });
    const waId = `9196${stamp.slice(-8)}`;
    const say = async (text: string, reply: string) => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const now = new Date();
      draft = reply;
      const conversation = await db.conversation.findFirst({ where: { workspaceId: workspace.id } });
      const before = new Set(conversation ? (await db.message.findMany({ where: { conversationId: conversation.id, author: "AI" }, select: { id: true } })).map((message) => message.id) : []);
      const events = normalizeMetaPayload("WHATSAPP", {
        object: "whatsapp_business_account",
        entry: [{ id: `waba-${stamp}`, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "919000000001", phone_number_id: wa.externalAccountId }, contacts: [{ profile: { name: "Karthikeyan" }, wa_id: waId }], messages: [{ from: waId, id: `wamid.${stamp}.${now.getTime()}`, timestamp: String(Math.floor(now.getTime() / 1000)), type: "text", text: { body: text } }] } }] }],
      }, now);
      await ingestEvents(db, { channel: "WHATSAPP", mode: "SIMULATION", events, receivedAt: now });
      await drain();
      const chat = await db.conversation.findFirstOrThrow({ where: { workspaceId: workspace.id } });
      return (await db.message.findMany({ where: { conversationId: chat.id, author: "AI" }, orderBy: { createdAt: "asc" } }))
        .filter((message) => !before.has(message.id)).map((message) => message.body).join("\n");
    };
    const answers = async () => JSON.stringify((await db.lead.findFirstOrThrow({ where: { workspaceId: workspace.id } })).answers);

    await say("Hello is this kharigahrs", "Yes, this is The KariGhars. I am Varun, the AI assistant. How can I help with your home?");
    await say("Hi varun. I want to do interiors for my house", "Sure. May I know your name?");
    await say("I'm karthikeyan", "Thanks Karthikeyan. Which area is your home in, and what is the property name?");
    const spot = await say("Adarsh palm retreat", "Most homes there are 2 and 3 BHK, what is the BHK of yours?");
    expect(spot).toMatch(/is that the Adarsh Palm Retreat villas on Sarjapur Road\?/i);
    await say("Yes yes", "Got it.");
    await say("3", "Got it.");
    await say("Home is ready", "Got it.");
    await say("Yes", "Got it.");
    // Basics are in: straight to the visit offer, never style, pooja, carpet area or timeline,
    // and digits inside an email are never read as a phone number.
    const offer = await say(`karthik${stamp.slice(-4)}@theaitel.com`, "Got it. Are you thinking of a specific style or do you need things like extra storage or a pooja space?");
    expect(offer).toMatch(/free consultation/i);
    expect(offer).not.toMatch(/style|pooja|carpet|sq ft|begin or end|start or finish|digits/i);
    const saved = await answers();
    expect(saved).toMatch(/Adarsh Palm Retreat, Sarjapur Road/);
    expect(saved).toMatch(/3 BHK Villa/);
    expect(saved).not.toMatch(/"style"/);

    // "Sorry villa" corrects the home, never the property.
    await say("Sorry villa", "Got it, a villa.");
    expect(await answers()).toMatch(/Adarsh Palm Retreat, Sarjapur Road/);

    const book = await say("Yes book a consultation", "Sure sir, which time inside working hours suits you? We are open Tuesday to Sunday, 10 AM to 7 PM.");
    expect(book).toMatch(/which (?:day and )?time/i);

    const day = await say("Tomorrow", "Noted sir, Saturday works. The team will confirm the slot.");
    expect(day).toMatch(/what time suits you|weekly off/i);
  });
});
