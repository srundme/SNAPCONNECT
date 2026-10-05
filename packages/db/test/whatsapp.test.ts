import { afterAll, describe, expect, it } from "vitest";
import { normalizeMetaPayload } from "@snapsocial/domain";
import { createPrisma } from "../src/client";
import { ingestEvents, processAvailableJobs, seedDemo, simulationRuntime } from "../src/index";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb("whatsapp chat", () => {
  const db = createPrisma(databaseUrl ?? "postgresql://unused");
  const runtime = simulationRuntime();

  afterAll(async () => {
    await db.$disconnect();
  });

  async function drain() {
    for (let index = 0; index < 12; index += 1) {
      const pending = await db.outboxJob.count({ where: { status: "PENDING", availableAt: { lte: new Date() } } });
      if (pending === 0) return;
      await processAvailableJobs(db, runtime, 30);
    }
  }

  function inbound(waId: string, id: string, text: string, at: Date) {
    return normalizeMetaPayload("WHATSAPP", {
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-test",
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "919000000000", phone_number_id: "pnid-test" },
            contacts: [{ profile: { name: "Kishore" }, wa_id: waId }],
            messages: [{ from: waId, id, timestamp: String(Math.floor(at.getTime() / 1000)), type: "text", text: { body: text } }],
          },
        }],
      }],
    }, at);
  }

  it("starts a lead from a WhatsApp message, knows the number and replies on the same chat", async () => {
    const seeded = await seedDemo(db);
    await db.channelConnection.upsert({
      where: { channel_mode_externalAccountId: { channel: "WHATSAPP", mode: "SIMULATION", externalAccountId: "pnid-test" } },
      update: { automationPaused: false, revokedAt: null },
      create: {
        workspaceId: seeded.workspaceId,
        channel: "WHATSAPP",
        mode: "SIMULATION",
        externalAccountId: "pnid-test",
        displayName: "Demo WhatsApp",
        automationPaused: false,
      },
    });
    const now = new Date(Date.now() - 120_000);
    const waId = `9198450${String(Date.now()).slice(-5)}`;
    const first = await ingestEvents(db, { channel: "WHATSAPP", mode: "SIMULATION", events: inbound(waId, `wamid.${now.getTime()}`, "Hi, I want AI calling for my business", now), receivedAt: now });
    expect(first.stored).toBe(1);
    await drain();

    const identity = await db.contactIdentity.findFirstOrThrow({ where: { channel: "WHATSAPP", externalId: waId }, include: { contact: true } });
    expect(identity.contact.displayName).toBe("Kishore");
    const lead = await db.lead.findFirstOrThrow({ where: { contactId: identity.contactId, archivedAt: null } });
    expect(lead.channel).toBe("WHATSAPP");
    expect(lead.sourceType).toBe("DIRECT_MESSAGE");
    expect(lead.phoneE164).toBe(`+${waId}`);
    const conversation = await db.conversation.findFirstOrThrow({ where: { contactId: identity.contactId }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    expect(conversation.channel).toBe("WHATSAPP");
    const replies = conversation.messages.filter((message) => message.author === "AI");
    expect(replies.length).toBe(1);
    expect(replies[0]!.body).toMatch(/automated/i);

    const later = new Date(now.getTime() + 60_000);
    await ingestEvents(db, { channel: "WHATSAPP", mode: "SIMULATION", events: inbound(waId, `wamid.${later.getTime()}`, "We are in Chennai", later), receivedAt: later });
    await drain();
    const after = await db.message.count({ where: { conversationId: conversation.id, author: "AI" } });
    expect(after).toBe(2);
  });
});
