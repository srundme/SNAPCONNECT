import { afterAll, describe, expect, it } from "vitest";
import { normalizeMetaPayload } from "@snapsocial/domain";
import { createPrisma } from "../src/client";
import { ingestEvents } from "../src/index";
import { fakeClaude } from "./fake-claude";
import { linkByPhoneOrEmail, linkContacts, mergePersonLeads, personLeads, processAvailableJobs, seedDemo, simulationRuntime, suggestMatches, unlinkContact, type Runtime } from "../src/index";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const QUESTIONS = [
  { id: "name", kind: "name", label: "May I know your name?", required: true, zohoField: "Last_Name" },
  { id: "where", kind: "text", label: "Where is the home: which area and which apartment or project?", required: true, zohoField: null },
  { id: "home", kind: "text", label: "What kind of home is it: apartment, villa or independent house, and how many BHK?", required: true, zohoField: null },
  { id: "when", kind: "text", label: "When do you get possession, or is the home already ready?", required: true, zohoField: null },
  { id: "phone", kind: "phone", label: "Which number should the team call you on?", required: true, zohoField: "Phone" },
  { id: "email", kind: "text", label: "Email for the team to share the details?", required: true, zohoField: "Email" },
];

describeDb("one person across channels", () => {
  const db = createPrisma(databaseUrl ?? "postgresql://unused");
  const upserts: Array<{ key: string | undefined; existingId: string | null | undefined; description: string | undefined }> = [];
  const base = simulationRuntime({ claude: fakeClaude() });
  const runtime: Runtime = {
    ...base,
    zoho: {
      ...base.zoho,
      async upsert(input) {
        upserts.push({ key: input.record.External_Lead_Key, existingId: input.existingId, description: input.record.Description });
        return base.zoho.upsert(input);
      },
    },
  };

  afterAll(async () => {
    await db.$disconnect();
  });

  async function setup() {
    const seeded = await seedDemo(db);
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const workspace = await db.workspace.create({
      data: { name: `People ${stamp}`, slug: `people-${stamp}`, mode: "SIMULATION", leadQuestions: QUESTIONS },
    });
    const connection = (channel: "INSTAGRAM" | "FACEBOOK" | "WHATSAPP") => db.channelConnection.create({
      data: { workspaceId: workspace.id, channel, mode: "SIMULATION", externalAccountId: `${channel}-${stamp}`, displayName: channel, automationPaused: false },
    });
    const [ig, fb, wa] = await Promise.all([connection("INSTAGRAM"), connection("FACEBOOK"), connection("WHATSAPP")]);
    const person = async (connectionId: string, channel: "INSTAGRAM" | "FACEBOOK" | "WHATSAPP", contact: { username?: string; displayName?: string; chosenName?: string | null }, lead: { answers?: Record<string, string>; phoneE164?: string | null; updatedAt?: Date }) => {
      const created = await db.contact.create({ data: { workspaceId: workspace.id, connectionId, channel, ...contact } });
      await db.conversation.create({ data: { workspaceId: workspace.id, connectionId, contactId: created.id, channel } });
      const newLead = await db.lead.create({
        data: { workspaceId: workspace.id, contactId: created.id, channel, connectionId, activeContactKey: created.id, sourceType: "DIRECT_MESSAGE", testRecord: true, answers: lead.answers ?? {}, phoneE164: lead.phoneE164 ?? null },
      });
      return { contact: created, lead: newLead };
    };
    return { seeded, workspace, ig, fb, wa, person };
  }

  async function drain() {
    for (let index = 0; index < 8; index += 1) {
      if (await db.outboxJob.count({ where: { status: "PENDING", availableAt: { lte: new Date() } } }) === 0) return;
      await processAvailableJobs(db, runtime, 30);
    }
  }

  it("joins Instagram and WhatsApp on the same phone number and shares every answer", async () => {
    const { workspace, ig, wa, person } = await setup();
    const insta = await person(ig.id, "INSTAGRAM", { username: "riteesh.shetty_93", chosenName: "Riteesh Shetty" }, { answers: { where: "Adarsh Palm Retreat", home: "4 BHK Villa" }, phoneE164: "+919663918221" });
    const whats = await person(wa.id, "WHATSAPP", { displayName: "Riteesh" }, { answers: { when: "Ready" }, phoneE164: "+919663918221" });

    expect(await linkByPhoneOrEmail(db, workspace.id, whats.contact.id)).toBe(true);
    const contacts = await db.contact.findMany({ where: { id: { in: [insta.contact.id, whats.contact.id] } } });
    expect(new Set(contacts.map((item) => item.personId)).size).toBe(1);
    expect(contacts[0]!.personId).toBeTruthy();

    const leads = await personLeads(db, whats.contact.id);
    for (const lead of leads) {
      expect(lead.answers).toMatchObject({ where: "Adarsh Palm Retreat", home: "4 BHK Villa", when: "Ready" });
    }
    const waContact = await db.contact.findUniqueOrThrow({ where: { id: whats.contact.id } });
    expect(waContact.chosenName).toBe("Riteesh Shetty");
  });

  it("never joins the same number under different names, and shows it to the team as a possible match", async () => {
    const { workspace, ig, wa, person } = await setup();
    const insta = await person(ig.id, "INSTAGRAM", { username: "riteesh_shetty", chosenName: "Riteesh" }, { answers: { where: "Sobha Royal Pavilion" }, phoneE164: "+916361977902" });
    const whats = await person(wa.id, "WHATSAPP", { displayName: "Arvind", chosenName: "Arvind" }, { answers: { home: "2 BHK Apartment" }, phoneE164: "+916361977902" });

    expect(await linkByPhoneOrEmail(db, workspace.id, insta.contact.id)).toBe(false);
    const contacts = await db.contact.findMany({ where: { id: { in: [insta.contact.id, whats.contact.id] } } });
    expect(contacts.every((item) => !item.personId) || new Set(contacts.map((item) => item.personId)).size === 2).toBe(true);
    const match = await db.personMatch.findFirstOrThrow({ where: { contactId: insta.contact.id, candidateId: whats.contact.id } });
    expect(match.status).toBe("SUGGESTED");
    expect(match.reasons).toMatch(/same phone number, different names \(Riteesh and Arvind\)/);
    expect((await db.lead.findUniqueOrThrow({ where: { id: insta.lead.id } })).answers).toEqual({ where: "Sobha Royal Pavilion" });
  });

  it("joins on the same email, newest answer wins", async () => {
    const { workspace, fb, ig, person } = await setup();
    const older = await person(fb.id, "FACEBOOK", { displayName: "Priya Nair", chosenName: "Priya" }, { answers: { email: "priya@example.com", home: "3 BHK Apartment" } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const newer = await person(ig.id, "INSTAGRAM", { username: "priya_n" }, { answers: { email: "Priya@Example.com", home: "4 BHK Apartment" } });
    await db.lead.update({ where: { id: newer.lead.id }, data: { updatedAt: new Date(Date.now() + 1000) } });
    expect(await linkByPhoneOrEmail(db, workspace.id, newer.contact.id)).toBe(true);
    const merged = await db.lead.findUniqueOrThrow({ where: { id: older.lead.id } });
    expect(merged.answers).toMatchObject({ home: "4 BHK Apartment" });
  });

  it("never joins on a name alone, but suggests a match on name and project", async () => {
    const { workspace, fb, ig, person } = await setup();
    const facebook = await person(fb.id, "FACEBOOK", { displayName: "Gopi Krishnan" }, { answers: { where: "Concorde Manhattans", home: "3 BHK Apartment" } });
    const sameNameOnly = await person(fb.id, "FACEBOOK", { displayName: "Gopi Raman" }, { answers: { where: "Prestige Lakeside" } });
    const instagram = await person(ig.id, "INSTAGRAM", { username: "gopi.krishnan_7" }, { answers: { where: "concorde manhattans, bengaluru", home: "3 BHK flat" } });

    const best = await suggestMatches(db, { workspaceId: workspace.id, contactId: instagram.contact.id, channel: "INSTAGRAM", now: new Date() });
    expect(best?.id).toBe(facebook.contact.id);
    expect(best!.score).toBeGreaterThanOrEqual(4);
    const matches = await db.personMatch.findMany({ where: { contactId: instagram.contact.id } });
    expect(matches.map((item) => item.candidateId)).not.toContain(sameNameOnly.contact.id);
    const stillSeparate = await db.contact.findUniqueOrThrow({ where: { id: instagram.contact.id } });
    expect(stillSeparate.personId).toBeNull();
  });

  it("sends one person on two channels to one Zoho record", async () => {
    const { workspace, ig, wa, person } = await setup();
    const full = { name: "x", where: "Sobha City", home: "3 BHK Apartment", when: "Ready", email: "ravi@example.com" };
    const insta = await person(ig.id, "INSTAGRAM", { username: "ravi.k", chosenName: "Ravi Kumar" }, { answers: full, phoneE164: "+919845011111" });
    await db.outboxJob.create({ data: { workspaceId: workspace.id, type: "CRM_SYNC", payload: { leadId: insta.lead.id, contactId: insta.contact.id } } });
    await drain();
    const firstMapping = await db.crmMapping.findUniqueOrThrow({ where: { leadId: insta.lead.id } });

    const whats = await person(wa.id, "WHATSAPP", { displayName: "Ravi", chosenName: "Ravi Kumar" }, { answers: { when: "In 2 months" }, phoneE164: "+919845011111" });
    await linkContacts(db, { workspaceId: workspace.id, contactId: whats.contact.id, otherId: insta.contact.id, evidence: "PHONE" });
    upserts.length = 0;
    await db.outboxJob.create({ data: { workspaceId: workspace.id, type: "CRM_SYNC", payload: { leadId: whats.lead.id, contactId: whats.contact.id } } });
    await drain();

    expect(upserts).toHaveLength(1);
    // An update goes to the existing record by its Zoho id; the lead key is only sent when the record is created.
    expect(upserts[0]!.existingId).toBe(firstMapping.crmId);
    expect(upserts[0]!.description).toMatch(/Channels: Instagram, WhatsApp/);
    const waMapping = await db.crmMapping.findUniqueOrThrow({ where: { leadId: whats.lead.id } });
    expect(waMapping.crmId).toBe(firstMapping.crmId);
  });

  it("continues on Instagram from where WhatsApp left off, without asking anything again", async () => {
    const { workspace, ig, wa, person } = await setup();
    await db.channelConnection.update({ where: { id: ig.id }, data: { mode: "SIMULATION" } });
    const answered = { where: "Adarsh Palm Retreat", home: "4 BHK Villa", when: "Ready", email: "riteesh@example.com" };
    const whats = await person(wa.id, "WHATSAPP", { displayName: "Riteesh", chosenName: "Riteesh Shetty" }, { answers: answered, phoneE164: "+919663918222" });
    const sender = `igsid-${Date.now()}`;
    const insta = await db.contact.create({ data: { workspaceId: workspace.id, connectionId: ig.id, channel: "INSTAGRAM", username: "riteesh.s" } });
    await db.contactIdentity.create({ data: { workspaceId: workspace.id, connectionId: ig.id, contactId: insta.id, channel: "INSTAGRAM", identityType: "MESSAGING_PARTICIPANT", externalId: sender, evidence: "INBOUND_MESSAGE" } });
    await db.lead.create({ data: { workspaceId: workspace.id, contactId: insta.id, channel: "INSTAGRAM", connectionId: ig.id, activeContactKey: insta.id, sourceType: "DIRECT_MESSAGE", testRecord: true } });
    await linkContacts(db, { workspaceId: workspace.id, contactId: insta.id, otherId: whats.contact.id, evidence: "STAFF" });

    const now = new Date(Date.now() - 60_000);
    const events = normalizeMetaPayload("INSTAGRAM", {
      object: "instagram",
      entry: [{ id: ig.externalAccountId, messaging: [{ sender: { id: sender }, recipient: { id: ig.externalAccountId }, timestamp: now.getTime(), message: { mid: `mid-${now.getTime()}`, text: "Hi, I am back about my home interiors" } }] }],
    }, now);
    await ingestEvents(db, { channel: "INSTAGRAM", mode: "SIMULATION", events, receivedAt: now });
    await drain();

    const igLead = await db.lead.findFirstOrThrow({ where: { contactId: insta.id, archivedAt: null } });
    expect(igLead.answers).toMatchObject(answered);
    expect(igLead.phoneE164).toBe("+919663918222");
    const replies = await db.message.findMany({ where: { conversation: { contactId: insta.id }, author: "AI" } });
    const text = replies.map((reply) => reply.body).join("\n");
    expect(replies.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\b(your name|which area|how many BHK|apartment, villa|possession|which number|email)\b/i);
    expect(text).toMatch(/free consultation|experience centre/i);
  });

  it("uses the Instagram first name without asking, and a typed name replaces it", async () => {
    const { workspace, ig } = await setup();
    const sender = `igsid-name-${Date.now()}`;
    const contact = await db.contact.create({ data: { workspaceId: workspace.id, connectionId: ig.id, channel: "INSTAGRAM", username: "gopi.talks" } });
    await db.contactIdentity.create({ data: { workspaceId: workspace.id, connectionId: ig.id, contactId: contact.id, channel: "INSTAGRAM", identityType: "MESSAGING_PARTICIPANT", externalId: sender, evidence: "INBOUND_MESSAGE" } });
    await db.lead.create({ data: { workspaceId: workspace.id, contactId: contact.id, channel: "INSTAGRAM", connectionId: ig.id, activeContactKey: contact.id, sourceType: "DIRECT_MESSAGE", testRecord: true } });
    const send = async (text: string, offsetMs: number) => {
      const at = new Date(Date.now() - 120_000 + offsetMs);
      const events = normalizeMetaPayload("INSTAGRAM", { object: "instagram", entry: [{ id: ig.externalAccountId, messaging: [{ sender: { id: sender }, recipient: { id: ig.externalAccountId }, timestamp: at.getTime(), message: { mid: `mid-${sender}-${offsetMs}`, text } }] }] }, at);
      await ingestEvents(db, { channel: "INSTAGRAM", mode: "SIMULATION", events, receivedAt: at });
      await drain();
    };
    await send("Hi, I need interiors for my home", 0);
    expect((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).chosenName).toBe("Gopi");
    const replies = await db.message.findMany({ where: { conversation: { contactId: contact.id }, author: "AI" } });
    expect(replies.map((reply) => reply.body).join(" ")).not.toMatch(/your name|am I chatting with|shall I note/i);
    await send("my name is Gopinath", 30_000);
    expect((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).chosenName).toBe("Gopinath");
  });

  it("staff can separate a contact joined by mistake", async () => {
    const { workspace, ig, wa, person } = await setup();
    const one = await person(ig.id, "INSTAGRAM", { username: "a.one" }, { phoneE164: "+919845022222" });
    const two = await person(wa.id, "WHATSAPP", { displayName: "A" }, { phoneE164: "+919845022222" });
    await linkByPhoneOrEmail(db, workspace.id, two.contact.id);
    await unlinkContact(db, workspace.id, two.contact.id, "staff");
    const both = await db.contact.findMany({ where: { id: { in: [one.contact.id, two.contact.id] } } });
    expect(both.every((item) => item.personId === null)).toBe(true);
    expect(await linkByPhoneOrEmail(db, workspace.id, two.contact.id)).toBe(false);
    expect(await mergePersonLeads(db, one.contact.id)).toBe(false);
  });
});
