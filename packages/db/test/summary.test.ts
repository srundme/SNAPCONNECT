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

});
