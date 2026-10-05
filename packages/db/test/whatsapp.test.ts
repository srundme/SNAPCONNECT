import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { normalizeMetaPayload } from "@snapsocial/domain";
import { encryptSecret } from "@snapsocial/integrations";
import { createPrisma } from "../src/client";
import { ingestEvents, processAvailableJobs, seedDemo, simulationRuntime, type Runtime } from "../src/index";

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
    expect(replies.length).toBeGreaterThanOrEqual(1);
    expect(replies.map((reply) => reply.body).join("\n")).toMatch(/automated/i);
    expect(replies.every((reply) => !/[,;!]/.test(reply.body))).toBe(true);

    const later = new Date(now.getTime() + 60_000);
    await ingestEvents(db, { channel: "WHATSAPP", mode: "SIMULATION", events: inbound(waId, `wamid.${later.getTime()}`, "We are in Chennai", later), receivedAt: later });
    await drain();
    const after = await db.message.count({ where: { conversationId: conversation.id, author: "AI" } });
    expect(after).toBeGreaterThan(replies.length);
  });

  it("answers a voice note with a voice reply and a typed message with text", async () => {
    const seeded = await seedDemo(db);
    const key = randomBytes(32);
    const spoken: string[] = [];
    const sent: Array<{ text: string; audioUrl?: string }> = [];
    const voiceRuntime: Runtime = {
      ...runtime,
      credentialKeys: { test: key },
      transcribe: async () => "Hi, I need interiors for my new flat",
      whatsappMediaUrl: async () => "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1",
      speak: async ({ transcript }) => {
        spoken.push(transcript);
        return { audio: new Uint8Array(300), mimeType: "audio/mpeg" };
      },
      publicBaseUrl: "https://app.test",
      send: async (input) => {
        sent.push({ text: input.text, audioUrl: input.audioUrl });
        return runtime.send(input);
      },
    };
    await db.channelConnection.upsert({
      where: { channel_mode_externalAccountId: { channel: "WHATSAPP", mode: "SIMULATION", externalAccountId: "pnid-test" } },
      update: { automationPaused: false, revokedAt: null, credentialCiphertext: encryptSecret("wa-token", key, "test") },
      create: {
        workspaceId: seeded.workspaceId,
        channel: "WHATSAPP",
        mode: "SIMULATION",
        externalAccountId: "pnid-test",
        displayName: "Demo WhatsApp",
        automationPaused: false,
        credentialCiphertext: encryptSecret("wa-token", key, "test"),
      },
    });
    const now = new Date(Date.now() - 120_000);
    const waId = `9198460${String(Date.now()).slice(-5)}`;
    const events = normalizeMetaPayload("WHATSAPP", {
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-test",
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "919000000000", phone_number_id: "pnid-test" },
            contacts: [{ profile: { name: "Anita" }, wa_id: waId }],
            messages: [{ from: waId, id: `wamid.v${now.getTime()}`, timestamp: String(Math.floor(now.getTime() / 1000)), type: "audio", audio: { id: "media-1", mime_type: "audio/ogg; codecs=opus", voice: true } }],
          },
        }],
      }],
    }, now);
    await ingestEvents(db, { channel: "WHATSAPP", mode: "SIMULATION", events, receivedAt: now });
    for (let index = 0; index < 12; index += 1) {
      if (await db.outboxJob.count({ where: { status: "PENDING", availableAt: { lte: new Date() } } }) === 0) break;
      await processAvailableJobs(db, voiceRuntime, 30);
    }

    const identity = await db.contactIdentity.findFirstOrThrow({ where: { channel: "WHATSAPP", externalId: waId } });
    const conversation = await db.conversation.findFirstOrThrow({ where: { contactId: identity.contactId }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    const inbound = conversation.messages.find((message) => message.author === "PROSPECT")!;
    expect(inbound.voice).toBe(true);
    expect(inbound.body).toBe("Hi, I need interiors for my new flat");
    const reply = conversation.messages.find((message) => message.author === "AI")!;
    expect(reply.voice).toBe(true);
    expect(reply.voiceClipId).toBeTruthy();
    expect(spoken.length).toBe(1);
    expect(spoken[0]).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(sent.at(-1)!.audioUrl).toBe(`https://app.test/api/voice/${reply.voiceClipId}.mp3`);
    const clip = await db.voiceClip.findUniqueOrThrow({ where: { id: reply.voiceClipId! } });
    expect(clip.mimeType).toBe("audio/mpeg");

    const later = new Date(now.getTime() + 60_000);
    await ingestEvents(db, { channel: "WHATSAPP", mode: "SIMULATION", events: inbound2(waId, later), receivedAt: later });
    for (let index = 0; index < 12; index += 1) {
      if (await db.outboxJob.count({ where: { status: "PENDING", availableAt: { lte: new Date() } } }) === 0) break;
      await processAvailableJobs(db, voiceRuntime, 30);
    }
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent.slice(1).every((item) => item.audioUrl === undefined)).toBe(true);
    expect(spoken.length).toBe(1);
  });

  function inbound2(waId: string, at: Date) {
    return inbound(waId, `wamid.t${at.getTime()}`, "It is a 2BHK in Chennai", at);
  }
});
