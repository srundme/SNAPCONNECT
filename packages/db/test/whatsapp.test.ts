import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { normalizeMetaPayload } from "@snapsocial/domain";
import { encryptSecret } from "@snapsocial/integrations";
import { createPrisma } from "../src/client";
import { ingestEvents, processAvailableJobs, seedDemo, simulationRuntime, type Runtime } from "../src/index";
import { fakeClaude } from "./fake-claude";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb("whatsapp chat", () => {
  const db = createPrisma(databaseUrl ?? "postgresql://unused");
  const runtime = simulationRuntime({ claude: fakeClaude() });

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

  it("describes a photo with the vision model and saves it with the caption", async () => {
    const seeded = await seedDemo(db);
    const key = randomBytes(32);
    const looked: Array<{ url: string; token?: string }> = [];
    const photoRuntime: Runtime = {
      ...runtime,
      credentialKeys: { test: key },
      whatsappMediaUrl: async () => "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=2",
      seeImage: async (url, token) => {
        looked.push({ url, token });
        return "A screenshot of a call log showing 40 missed calls.";
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
    const waId = `9198470${String(Date.now()).slice(-5)}`;
    const events = normalizeMetaPayload("WHATSAPP", {
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-test",
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "919000000000", phone_number_id: "pnid-test" },
            contacts: [{ profile: { name: "Ravi" }, wa_id: waId }],
            messages: [{ from: waId, id: `wamid.p${now.getTime()}`, timestamp: String(Math.floor(now.getTime() / 1000)), type: "image", image: { id: "img-7", mime_type: "image/jpeg", caption: "this is our problem" } }],
          },
        }],
      }],
    }, now);
    await ingestEvents(db, { channel: "WHATSAPP", mode: "SIMULATION", events, receivedAt: now });
    for (let index = 0; index < 12; index += 1) {
      if (await db.outboxJob.count({ where: { status: "PENDING", availableAt: { lte: new Date() } } }) === 0) break;
      await processAvailableJobs(db, photoRuntime, 30);
    }
    const identity = await db.contactIdentity.findFirstOrThrow({ where: { channel: "WHATSAPP", externalId: waId } });
    const conversation = await db.conversation.findFirstOrThrow({ where: { contactId: identity.contactId }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    const photo = conversation.messages.find((message) => message.author === "PROSPECT")!;
    expect(photo.body).toBe("this is our problem (Sent a photo. It shows: A screenshot of a call log showing 40 missed calls.)");
    expect(looked).toEqual([{ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=2", token: "wa-token" }]);
    expect(conversation.messages.some((message) => message.author === "AI")).toBe(true);
  });

  it("reads a PDF in the background and replies only once it is read", async () => {
    const seeded = await seedDemo(db);
    const key = randomBytes(32);
    const started: Array<{ url: string; token?: string; name: string | null }> = [];
    let polls = 0;
    const documentRuntime: Runtime = {
      ...runtime,
      credentialKeys: { test: key },
      whatsappMediaUrl: async () => "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=9",
      readDocument: {
        start: async (url, token, name) => {
          started.push({ url, token, name });
          return "job-1";
        },
        poll: async () => {
          polls += 1;
          return polls < 2 ? { state: "running", text: "" } : { state: "done", text: "# Unit 1204\n3 BHK floor plan, carpet area 1,450 sq ft" };
        },
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
    const waId = `9198480${String(Date.now()).slice(-5)}`;
    const events = normalizeMetaPayload("WHATSAPP", {
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-test",
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "919000000000", phone_number_id: "pnid-test" },
            contacts: [{ profile: { name: "Meena" }, wa_id: waId }],
            messages: [{ from: waId, id: `wamid.d${now.getTime()}`, timestamp: String(Math.floor(now.getTime() / 1000)), type: "document", document: { id: "doc-3", filename: "plan (1204).pdf", mime_type: "application/pdf" } }],
          },
        }],
      }],
    }, now);
    await ingestEvents(db, { channel: "WHATSAPP", mode: "SIMULATION", events, receivedAt: now });
    const identityWhere = { channel: "WHATSAPP" as const, externalId: waId };
    for (let round = 0; round < 6; round += 1) {
      await db.outboxJob.updateMany({ where: { type: { in: ["READ_DOCUMENT", "INFERENCE"] }, status: "PENDING" }, data: { availableAt: new Date(Date.now() - 1000) } });
      await processAvailableJobs(db, documentRuntime, 30);
      if (round === 0) {
        const identity = await db.contactIdentity.findFirstOrThrow({ where: identityWhere });
        const replies = await db.message.count({ where: { conversation: { contactId: identity.contactId }, author: "AI" } });
        expect(replies).toBe(0);
      }
    }
    const identity = await db.contactIdentity.findFirstOrThrow({ where: identityWhere });
    const conversation = await db.conversation.findFirstOrThrow({ where: { contactId: identity.contactId }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    const sent = conversation.messages.find((message) => message.author === "PROSPECT")!;
    expect(started).toEqual([{ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=9", token: "wa-token", name: "plan (1204).pdf" }]);
    expect(sent.body).toMatch(/^\(Sent a document \[plan 1204\.pdf\]\. It shows: .*3 BHK floor plan, carpet area 1,450 sq ft\)$/);
    expect(conversation.messages.filter((message) => message.author === "AI").length).toBeGreaterThanOrEqual(1);
  });

  it("joins a WhatsApp chat to the Instagram contact who gave that number, and schedules a follow-up", async () => {
    const seeded = await seedDemo(db);
    const instagram = await db.channelConnection.findFirstOrThrow({ where: { workspaceId: seeded.workspaceId, channel: "INSTAGRAM" } });
    await db.channelConnection.upsert({
      where: { channel_mode_externalAccountId: { channel: "WHATSAPP", mode: "SIMULATION", externalAccountId: "pnid-test" } },
      update: { automationPaused: false, revokedAt: null },
      create: { workspaceId: seeded.workspaceId, channel: "WHATSAPP", mode: "SIMULATION", externalAccountId: "pnid-test", displayName: "Demo WhatsApp", automationPaused: false },
    });
    const before = await db.workspace.findUniqueOrThrow({ where: { id: seeded.workspaceId }, select: { agentSettings: true } });
    await db.workspace.update({ where: { id: seeded.workspaceId }, data: { agentSettings: { followUps: true, followUpHours: [3, 20] } } });
    try {
      const waId = `9198480${String(Date.now()).slice(-5)}`;
      const contact = await db.contact.create({
        data: {
          workspaceId: seeded.workspaceId,
          connectionId: instagram.id,
          channel: "INSTAGRAM",
          displayName: "Meera",
          identities: { create: { workspaceId: seeded.workspaceId, connectionId: instagram.id, channel: "INSTAGRAM", identityType: "MESSAGING_PARTICIPANT", externalId: `ig-${waId}`, evidence: "INBOUND_MESSAGE" } },
        },
      });
      await db.lead.create({
        data: { workspaceId: seeded.workspaceId, contactId: contact.id, channel: "INSTAGRAM", connectionId: instagram.id, activeContactKey: contact.id, sourceType: "DIRECT_MESSAGE", testRecord: true, phoneE164: `+${waId}` },
      });
      const now = new Date(Date.now() - 60_000);
      await ingestEvents(db, { channel: "WHATSAPP", mode: "SIMULATION", events: inbound(waId, `wamid.x${now.getTime()}`, "Hi, I messaged you on Instagram about my flat", now), receivedAt: now });
      await drain();

      const identity = await db.contactIdentity.findFirstOrThrow({ where: { channel: "WHATSAPP", externalId: waId } });
      expect(identity.contactId).toBe(contact.id);
      expect(await db.lead.count({ where: { contactId: contact.id, archivedAt: null } })).toBe(1);
      const chat = await db.conversation.findFirstOrThrow({ where: { contactId: contact.id, channel: "WHATSAPP" } });
      expect(await db.message.count({ where: { conversationId: chat.id, author: "AI" } })).toBeGreaterThanOrEqual(1);
      const followUp = await db.outboxJob.findFirst({ where: { type: "FOLLOW_UP", payload: { path: ["conversationId"], equals: chat.id } } });
      expect(followUp).toBeTruthy();
      expect(followUp!.availableAt.getTime()).toBeLessThan(now.getTime() + 23.5 * 3_600_000);
      expect(followUp!.availableAt.getTime()).toBeGreaterThan(now.getTime() + 2.9 * 3_600_000);
      await db.outboxJob.update({ where: { id: followUp!.id }, data: { status: "COMPLETED" } });
    } finally {
      await db.workspace.update({ where: { id: seeded.workspaceId }, data: { agentSettings: before.agentSettings ?? {} } });
    }
  });

  function inbound2(waId: string, at: Date) {
    return inbound(waId, `wamid.t${at.getTime()}`, "It is a 2BHK in Chennai", at);
  }
});
