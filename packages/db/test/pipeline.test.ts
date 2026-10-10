import { afterAll, describe, expect, it } from "vitest";
import { normalizeMetaPayload } from "@snapsocial/domain";
import { readSimulationCrm } from "@snapsocial/integrations";
import { createPrisma } from "../src/client";
import { deleteContactData, ingestEvents, processAvailableJobs, seedDemo, setConnectionPaused, simulationRuntime, takeOver, type Runtime } from "../src/index";
import { fakeClaude } from "./fake-claude";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb("two-channel simulation", () => {
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

  it("keeps colliding ids apart and syncs both channels", async () => {
    const seeded = await seedDemo(db);
    const now = new Date();
    const sharedId = `shared-native-${now.getTime()}`;
    const igParticipant = `igsid-${now.getTime()}`;
    const igMessageId = `mid-ig-${now.getTime()}`;
    const fbAuthor = `fb-author-${now.getTime()}`;
    const unattributedMessageId = `mid-unattributed-${now.getTime()}`;
    const instagram = normalizeMetaPayload(
      "INSTAGRAM",
      {
        object: "instagram",
        entry: [
          {
            id: "17841405880000001",
            changes: [
              {
                field: "comments",
                value: {
                  id: sharedId,
                  text: "Need interiors for my home",
                  from: { id: "ig-author-1", username: "prospect_ig" },
                  media: { id: "media-ig-1", media_product_type: "FEED" },
                },
              },
            ],
          },
        ],
      },
      now,
    );
    const facebook = normalizeMetaPayload(
      "FACEBOOK",
      {
        object: "page",
        entry: [
          {
            id: "100860000000001",
            changes: [
              {
                field: "feed",
                value: {
                  item: "comment",
                  verb: "add",
                  comment_id: sharedId,
                  post_id: "100860000000001_9001",
                  sender_id: fbAuthor,
                  sender_name: "Page Prospect",
                  message: "Need interiors for my home",
                  created_time: Math.floor(now.getTime() / 1000),
                },
              },
            ],
          },
        ],
      },
      now,
    );
    const first = await ingestEvents(db, { channel: "INSTAGRAM", mode: "SIMULATION", events: instagram, receivedAt: now });
    const again = await ingestEvents(db, { channel: "INSTAGRAM", mode: "SIMULATION", events: instagram, receivedAt: now });
    const fb = await ingestEvents(db, { channel: "FACEBOOK", mode: "SIMULATION", events: facebook, receivedAt: now });
    expect(first.stored).toBe(1);
    expect(again.duplicate).toBe(1);
    expect(fb.stored).toBe(1);
    await drain();
    const attempts = await db.outboundAttempt.findMany({ where: { commentExternalId: sharedId } });
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts.map((item) => item.channel)).size).toBe(2);
    expect(attempts.every((item) => item.status === "ACCEPTED" && item.simulated)).toBe(true);

    const reply = normalizeMetaPayload(
      "INSTAGRAM",
      {
        object: "instagram",
        entry: [
          {
            id: "17841405880000001",
            messaging: [
              {
                sender: { id: igParticipant },
                recipient: { id: "17841405880000001" },
                timestamp: now.getTime(),
                message: { mid: igMessageId, text: "It is a home in Mysuru. Full home interiors. Budget is 15 lakhs. Start next month. Call +91 98450 12345. You can call me. WhatsApp is different +91 90000 11111." },
                referral: { comment_id: sharedId },
              },
            ],
          },
        ],
      },
      now,
    );
    await ingestEvents(db, { channel: "INSTAGRAM", mode: "SIMULATION", events: reply, receivedAt: now });
    await drain();
    const igLead = await db.lead.findFirst({
      where: { connectionId: seeded.instagramId, sourceCommentId: sharedId, archivedAt: null },
      include: { contact: { include: { identities: true } }, crm: true },
    });
    expect(igLead?.city).toBe("Mysuru");
    expect(igLead?.projectType).toBe("residential");
    expect(igLead?.budgetAmountMinor).toBe(1_500_000);
    expect(igLead?.phoneE164).toBe("+919845012345");
    expect(igLead?.whatsappE164).toBe("+919000011111");
    expect(igLead?.phonePermission).toBe(true);
    expect(igLead?.qualification === "QUALIFIED" || igLead?.qualification === "CONTACTABLE").toBe(true);
    expect(igLead?.crm?.simulated).toBe(true);
    expect(igLead?.crm?.crmId).toBeTruthy();
    expect(readSimulationCrm(igLead?.crm?.crmId ?? "")?.Lead_Source).toBe("Instagram");
    expect(igLead?.contact.identities.some((item) => item.identityType === "COMMENT_AUTHOR")).toBe(true);
    expect(igLead?.contact.identities.some((item) => item.identityType === "MESSAGING_PARTICIPANT" && item.externalId === igParticipant)).toBe(true);

    const unattributed = normalizeMetaPayload(
      "FACEBOOK",
      {
        object: "page",
        entry: [
          {
            id: "100860000000001",
            messaging: [
              {
                sender: { id: fbAuthor },
                recipient: { id: "100860000000001" },
                timestamp: now.getTime(),
                message: { mid: unattributedMessageId, text: "Hello from messenger" },
              },
            ],
          },
        ],
      },
      now,
    );
    await ingestEvents(db, { channel: "FACEBOOK", mode: "SIMULATION", events: unattributed, receivedAt: now });
    await drain();
    const identities = await db.contactIdentity.findMany({ where: { externalId: fbAuthor } });
    expect(identities.map((item) => item.identityType).sort()).toEqual(["COMMENT_AUTHOR", "MESSAGING_PARTICIPANT"]);
    expect(new Set(identities.map((item) => item.contactId)).size).toBe(2);
    const direct = await db.lead.findFirst({ where: { sourceType: "DIRECT_MESSAGE", channel: "FACEBOOK" } });
    expect(direct?.sourceMediaId).toBeNull();

    await setConnectionPaused(db, seeded.facebookId, true, "tester");
    const igStill = await db.channelConnection.findUniqueOrThrow({ where: { id: seeded.instagramId } });
    expect(igStill.automationPaused).toBe(false);
    await setConnectionPaused(db, seeded.facebookId, false, "tester");
    const conversation = await db.conversation.findFirstOrThrow({ where: { contactId: igLead?.contactId ?? "" } });
    await takeOver(db, conversation.id, "tester");
    const owned = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(owned.owner).toBe("HUMAN");

    const crmId = igLead?.crm?.crmId ?? "";
    const edit = normalizeMetaPayload(
      "INSTAGRAM",
      {
        object: "instagram",
        entry: [
          {
            id: "17841405880000001",
            messaging: [
              {
                sender: { id: igParticipant },
                recipient: { id: "17841405880000001" },
                timestamp: now.getTime() + 60_000,
                message_edit: { mid: igMessageId, num_edit: 1, text: "It is a home in Mysuru. Full home interiors. Budget is 15 lakhs. Start next month. Call +91 89048 87500. You can call me. WhatsApp is different +91 90000 11111." },
              },
            ],
          },
        ],
      },
      now,
    );
    await ingestEvents(db, { channel: "INSTAGRAM", mode: "SIMULATION", events: edit, receivedAt: new Date() });
    await drain();
    const corrected = await db.lead.findUniqueOrThrow({ where: { id: igLead?.id ?? "" }, include: { crm: true } });
    expect(corrected.phoneE164).toBe("+918904887500");
    expect(corrected.crm?.crmId).toBe(crmId);
    expect(corrected.crm?.syncedRevision).toBe(corrected.revision);
    expect(readSimulationCrm(crmId)?.Phone).toBe("+918904887500");

    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: seeded.workspaceId } });
    await db.workspace.update({
      where: { id: seeded.workspaceId },
      data: { leadQuestions: [{ id: "requirement", label: "Requirement", kind: "text", zohoField: null }] },
    });
    const reading: Runtime = {
      ...runtime,
      llm: { ...runtime.llm, extractAnswers: async () => ({ requirement: "Only modular kitchen", "preferred-call-time": "tomorrow 5 PM" }) },
    };
    const secondEdit = normalizeMetaPayload(
      "INSTAGRAM",
      {
        object: "instagram",
        entry: [
          {
            id: "17841405880000001",
            messaging: [
              {
                sender: { id: igParticipant },
                recipient: { id: "17841405880000001" },
                timestamp: now.getTime() + 120_000,
                message_edit: { mid: igMessageId, num_edit: 2, text: "It is a home in Mysuru. Only modular kitchen. Budget is 15 lakhs. Call tomorrow 5 PM on +91 89048 87500." },
              },
            ],
          },
        ],
      },
      now,
    );
    const repliesBefore = await db.message.count({ where: { conversationId: conversation.id, author: "AI" } });
    try {
      await ingestEvents(db, { channel: "INSTAGRAM", mode: "SIMULATION", events: secondEdit, receivedAt: new Date() });
      for (let index = 0; index < 12; index += 1) {
        if (await db.outboxJob.count({ where: { status: "PENDING", availableAt: { lte: new Date() } } }) === 0) break;
        await processAvailableJobs(db, reading, 30);
      }
    } finally {
      await db.workspace.update({ where: { id: seeded.workspaceId }, data: { leadQuestions: workspace.leadQuestions as never } });
    }
    const reread = await db.lead.findUniqueOrThrow({ where: { id: igLead?.id ?? "" }, include: { crm: true } });
    expect((reread.answers as Record<string, string>).requirement).toBe("Only modular kitchen");
    expect(reread.timeframeRaw).toBe("tomorrow 5 PM");
    expect(reread.crm?.crmId).toBe(crmId);
    expect(reread.crm?.syncedRevision).toBe(reread.revision);
    expect(readSimulationCrm(crmId)?.Description).toContain("Preferred call time: tomorrow 5 PM");
    expect(await db.message.count({ where: { conversationId: conversation.id, author: "AI" } })).toBe(repliesBefore);

    await deleteContactData(db, igLead?.contactId ?? "", seeded.workspaceId, "tester");
    const gone = await db.contact.findUnique({ where: { id: igLead?.contactId ?? "" } });
    expect(gone).toBeNull();
    const other = await db.contact.findFirst({ where: { connectionId: seeded.facebookId } });
    expect(other).toBeTruthy();
  });
});
