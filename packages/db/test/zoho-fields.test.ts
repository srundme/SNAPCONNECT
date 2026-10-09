import { afterAll, describe, expect, it } from "vitest";
import { editSimulationCrm, readSimulationCrm } from "@snapsocial/integrations";
import { createPrisma } from "../src/client";
import { processAvailableJobs, seedDemo, simulationRuntime, type Runtime } from "../src/index";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const QUESTIONS = [
  { id: "name", kind: "name", label: "May I know your name?", required: true, zohoField: "Last_Name" },
  { id: "where", kind: "text", label: "Where is the home: which area, and what is the property name?", required: true, zohoField: "Project_Location" },
  { id: "home", kind: "text", label: "What kind of home is it: apartment, villa or independent house, and how many BHK?", required: true, zohoField: "Home_Type" },
  { id: "when", kind: "text", label: "When do you get possession, or is the home already ready?", required: true, zohoField: "Possession" },
  { id: "phone", kind: "phone", label: "Which number should the team call you on?", required: true, zohoField: "Phone" },
  { id: "email", kind: "text", label: "Email for the team to share the details?", required: true, zohoField: "Email" },
];

describeDb("Zoho updates keep the team's edits", () => {
  const db = createPrisma(databaseUrl ?? "postgresql://unused");
  const sentRecords: Array<Record<string, string>> = [];
  const base = simulationRuntime();
  const runtime: Runtime = { ...base, zoho: { ...base.zoho, upsert: async (input) => { sentRecords.push(input.record); return base.zoho.upsert(input); } } };
  afterAll(async () => {
    await db.$disconnect();
  });

  async function drain() {
    for (let index = 0; index < 8; index += 1) {
      if (await db.outboxJob.count({ where: { status: "PENDING", availableAt: { lte: new Date() } } }) === 0) return;
      await processAvailableJobs(db, runtime, 30);
    }
  }

  it("sends only what changed in the chat and never overwrites what the team filled in Zoho", async () => {
    await seedDemo(db);
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const workspace = await db.workspace.create({ data: { name: `Zoho ${stamp}`, slug: `zoho-${stamp}`, mode: "SIMULATION", leadQuestions: QUESTIONS } });
    const wa = await db.channelConnection.create({ data: { workspaceId: workspace.id, channel: "WHATSAPP", mode: "SIMULATION", externalAccountId: `wa-z-${stamp}`, displayName: "WA", automationPaused: false } });
    const contact = await db.contact.create({ data: { workspaceId: workspace.id, connectionId: wa.id, channel: "WHATSAPP", chosenName: "Ravi Kumar" } });
    const lead = await db.lead.create({
      data: { workspaceId: workspace.id, contactId: contact.id, channel: "WHATSAPP", connectionId: wa.id, activeContactKey: contact.id, sourceType: "DIRECT_MESSAGE", phoneE164: "+919845055555", answers: { where: "Sobha City", home: "3 BHK Apartment", when: "Ready" } },
    });
    const sync = async () => {
      await db.outboxJob.create({ data: { workspaceId: workspace.id, type: "CRM_SYNC", payload: { leadId: lead.id, contactId: contact.id } } });
      await drain();
    };

    await sync();
    const mapping = await db.crmMapping.findUniqueOrThrow({ where: { leadId: lead.id } });
    expect(sentRecords.at(-1)).toMatchObject({ Home_Type: "3 BHK Apartment", Phone: "+919845055555" });

    // The team works the lead in Zoho: a better phone after the call, and an email they got on the phone.
    editSimulationCrm(mapping.crmId!, { Phone: "+919999900000", Email: "ravi.team@example.com" });

    // Later in the chat the customer corrects the BHK and gives an email.
    await db.lead.update({ where: { id: lead.id }, data: { answers: { where: "Sobha City", home: "4 BHK Apartment", when: "Ready", email: "ravi@example.com" }, revision: { increment: 1 } } });
    sentRecords.length = 0;
    await sync();

    expect(sentRecords).toHaveLength(1);
    expect(sentRecords[0]).toMatchObject({ Home_Type: "4 BHK Apartment" });
    expect(sentRecords[0]).not.toHaveProperty("Phone");
    expect(sentRecords[0]).not.toHaveProperty("Email");
    expect(sentRecords[0]).not.toHaveProperty("Last_Name");
    const inZoho = readSimulationCrm(mapping.crmId!)!;
    expect(inZoho.Phone).toBe("+919999900000");
    expect(inZoho.Email).toBe("ravi.team@example.com");
    expect(inZoho.Home_Type).toBe("4 BHK Apartment");

    // Nothing new in the chat: no call to Zoho at all.
    await db.lead.update({ where: { id: lead.id }, data: { revision: { increment: 1 } } });
    sentRecords.length = 0;
    await sync();
    expect(sentRecords).toHaveLength(0);

    // The customer corrects the phone in the chat: that is their own correction, so it replaces the team's.
    await db.lead.update({ where: { id: lead.id }, data: { phoneE164: "+919845066666", revision: { increment: 1 } } });
    await sync();
    expect(readSimulationCrm(mapping.crmId!)!.Phone).toBe("+919845066666");
  });
});
