import { afterAll, describe, expect, it } from "vitest";
import { createPrisma } from "../src/client";
import { alertRecipients, raiseAlert, seedDemo, simulationRuntime, type Runtime } from "../src/index";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describe("alert recipients", () => {
  it("reads names and numbers, skipping lines that are not numbers", () => {
    expect(alertRecipients("Gopi: +91 98450 11111\nRavi - 9900022222\nnot a number")).toEqual([
      { name: "Gopi", waId: "919845011111" },
      { name: "Ravi", waId: "919900022222" },
    ]);
  });
});

describeDb("team alerts", () => {
  const db = createPrisma(databaseUrl ?? "postgresql://unused");
  afterAll(async () => {
    await db.$disconnect();
  });

  it("alerts the person who owns the chat once, and records what was sent", async () => {
    await seedDemo(db);
    const sent: Array<{ to?: string; text: string }> = [];
    const base = simulationRuntime();
    const runtime: Runtime = { ...base, publicBaseUrl: "https://app.test", send: async (input) => { sent.push({ to: input.recipientId, text: input.text }); return base.send(input); } };
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const workspace = await db.workspace.create({
      data: { name: `Alerts ${stamp}`, slug: `alerts-${stamp}`, mode: "SIMULATION", agentSettings: { alertNumbers: "Gopi Krishnan: +91 98450 11111\nRavi: +91 99000 22222" } },
    });
    const wa = await db.channelConnection.create({ data: { workspaceId: workspace.id, channel: "WHATSAPP", mode: "SIMULATION", externalAccountId: `wa-${stamp}`, displayName: "WA", automationPaused: false } });
    const contact = await db.contact.create({ data: { workspaceId: workspace.id, connectionId: wa.id, channel: "WHATSAPP", displayName: "Riteesh" } });
    const user = await db.user.create({ data: { id: `u-${stamp}`, name: "Gopi", email: `gopi-${stamp}@example.com`, emailVerified: true } });
    const conversation = await db.conversation.create({ data: { workspaceId: workspace.id, connectionId: wa.id, contactId: contact.id, channel: "WHATSAPP", owner: "HUMAN", ownerUserId: user.id } });

    await raiseAlert(db, runtime, { workspaceId: workspace.id, conversationId: conversation.id, kind: "hot", text: "🔥 HOT lead: Riteesh" });
    await raiseAlert(db, runtime, { workspaceId: workspace.id, conversationId: conversation.id, kind: "hot", text: "🔥 HOT lead: Riteesh" });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("919845011111");
    expect(sent[0]!.text).toContain(`https://app.test/inbox?id=${conversation.id}`);
    const alerts = await db.teamAlert.findMany({ where: { conversationId: conversation.id } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.deliveredTo).toMatch(/Gopi Krishnan: sent/);
  });
});
