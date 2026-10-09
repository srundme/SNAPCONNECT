import { afterAll, describe, expect, it } from "vitest";
import { normalizeMetaPayload } from "@snapsocial/domain";
import { createPrisma } from "../src/client";
import { ingestEvents, processAvailableJobs, seedDemo, sendDailySummaries, simulationRuntime, type Runtime } from "../src/index";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb("owner summary and spam", () => {
  const db = createPrisma(databaseUrl ?? "postgresql://unused");
  afterAll(async () => {
    await db.$disconnect();
  });

  it("sends yesterday's numbers to every owner once, after 9 AM India time", async () => {
    await seedDemo(db);
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const sent: Array<{ to?: string; text: string }> = [];
    const base = simulationRuntime();
    const runtime: Runtime = { ...base, send: async (input) => { sent.push({ to: input.recipientId, text: input.text }); return base.send(input); } };
    const workspace = await db.workspace.create({
      data: { name: `Owners ${stamp}`, slug: `owners-${stamp}`, brandName: "Test Homes", mode: "SIMULATION", agentSettings: { summaryNumbers: "Owner: +91 98450 33333\nPartner: +91 99000 44444" } },
    });
    const wa = await db.channelConnection.create({ data: { workspaceId: workspace.id, channel: "WHATSAPP", mode: "SIMULATION", externalAccountId: `wa-sum-${stamp}`, displayName: "WA", automationPaused: false } });
    // 10:00 IST on 9 Oct; "yesterday" is 8 Oct IST.
    const now = new Date("2026-10-09T04:30:00Z");
    const yesterday = new Date("2026-10-08T06:00:00Z");
    for (const [index, rating] of (["HOT", "UNRATED"] as const).entries()) {
      const contact = await db.contact.create({ data: { workspaceId: workspace.id, connectionId: wa.id, channel: "WHATSAPP", displayName: `C${index}` } });
      await db.conversation.create({ data: { workspaceId: workspace.id, connectionId: wa.id, contactId: contact.id, channel: "WHATSAPP", createdAt: yesterday } });
      await db.lead.create({ data: { workspaceId: workspace.id, contactId: contact.id, channel: "WHATSAPP", connectionId: wa.id, activeContactKey: contact.id, sourceType: "DIRECT_MESSAGE", phoneE164: `+91984503333${index}`, rating, createdAt: yesterday } });
    }
    await sendDailySummaries(db, runtime, new Date("2026-10-09T02:00:00Z"));
    expect(sent.filter((item) => item.text.includes("Test Homes"))).toHaveLength(0);
    await sendDailySummaries(db, runtime, now);
    await sendDailySummaries(db, runtime, now);
    const ours = sent.filter((item) => item.text.includes("Test Homes"));
    expect(ours.map((item) => item.to).sort()).toEqual(["919845033333", "919900044444"]);
    expect(ours[0]!.text).toMatch(/2 chats · 2 new leads · 1 HOT/);
  });

  it("pauses a chat that floods messages", async () => {
    const seeded = await seedDemo(db);
    await db.channelConnection.upsert({
      where: { channel_mode_externalAccountId: { channel: "WHATSAPP", mode: "SIMULATION", externalAccountId: "pnid-flood" } },
      update: { automationPaused: false, revokedAt: null },
      create: { workspaceId: seeded.workspaceId, channel: "WHATSAPP", mode: "SIMULATION", externalAccountId: "pnid-flood", displayName: "WA flood", automationPaused: false },
    });
    const waId = `9198480${String(Date.now()).slice(-5)}`;
    const base = Date.now() - 120_000;
    for (let index = 0; index < 16; index += 1) {
      const at = new Date(base + index * 1000);
      const events = normalizeMetaPayload("WHATSAPP", {
        object: "whatsapp_business_account",
        entry: [{ id: "waba-flood", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "919000000001", phone_number_id: "pnid-flood" }, contacts: [{ profile: { name: "Flood" }, wa_id: waId }], messages: [{ from: waId, id: `wamid.flood.${waId}.${index}`, timestamp: String(Math.floor(at.getTime() / 1000)), type: "text", text: { body: `message number ${index}` } }] } }] }],
      }, at);
      await ingestEvents(db, { channel: "WHATSAPP", mode: "SIMULATION", events, receivedAt: at });
    }
    const runtime = simulationRuntime();
    for (let index = 0; index < 20; index += 1) {
      if (await db.outboxJob.count({ where: { status: "PENDING", availableAt: { lte: new Date() } } }) === 0) break;
      await processAvailableJobs(db, runtime, 40);
    }
    const identity = await db.contactIdentity.findFirstOrThrow({ where: { channel: "WHATSAPP", externalId: waId } });
    const conversation = await db.conversation.findFirstOrThrow({ where: { contactId: identity.contactId } });
    const notes = await db.message.findMany({ where: { conversationId: conversation.id, author: "SYSTEM", body: { startsWith: "Situation: flood" } } });
    expect(notes.length).toBe(1);
  });
});
