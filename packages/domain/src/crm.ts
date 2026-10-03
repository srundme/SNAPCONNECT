export type ZohoFieldMeta = {
  apiName: string;
  required: boolean;
  dataType: string;
  picklist: string[];
};

export type ZohoMapping = {
  lastNameField: "Last_Name";
  phoneField: "Phone" | "Mobile" | null;
  whatsappField: string | null;
  cityField: "City" | string | null;
  projectField: string | null;
  budgetField: string | null;
  timeframeField: string | null;
  sourceField: "Lead_Source";
  instagramSourceValue: string;
  facebookSourceValue: string;
  externalKeyField: string | null;
  descriptionFallback: boolean;
};

export type ZohoLeadInput = {
  leadId: string;
  channel: "INSTAGRAM" | "FACEBOOK";
  chosenName: string | null;
  username: string | null;
  displayName: string | null;
  phoneE164: string | null;
  whatsappE164: string | null;
  city: string | null;
  projectType: string | null;
  requirement: string | null;
  budgetRaw: string | null;
  timeframeRaw: string | null;
  connectionLabel: string;
  postId: string | null;
  permissionSummary: string;
  testRecord: boolean;
};

export function displayLastName(input: Pick<ZohoLeadInput, "chosenName" | "username" | "displayName" | "leadId" | "channel" | "testRecord">): string {
  const prefix = input.testRecord ? "[TEST] " : "";
  if (input.chosenName?.trim()) return `${prefix}${input.chosenName.trim()}`;
  if (input.username?.trim()) return `${prefix}${input.channel === "INSTAGRAM" ? "Instagram" : "Facebook"} user @${input.username.trim()}`;
  if (input.displayName?.trim()) return `${prefix}${input.channel} name ${input.displayName.trim()}`;
  return `${prefix}Prospect ${input.leadId.slice(0, 8)}`;
}

export function validateZohoMapping(mapping: ZohoMapping, fields: ZohoFieldMeta[]): string[] {
  const errors: string[] = [];
  const byName = new Map(fields.map((field) => [field.apiName, field]));
  const last = byName.get("Last_Name");
  if (!last) errors.push("Last_Name is missing from the layout.");
  const used = [
    mapping.phoneField,
    mapping.whatsappField,
    mapping.cityField,
    mapping.projectField,
    mapping.budgetField,
    mapping.timeframeField,
    mapping.externalKeyField,
    "Lead_Source",
  ].filter((value): value is string => Boolean(value));
  for (const name of used) {
    if (!byName.has(name)) errors.push(`Field ${name} is not available.`);
  }
  const source = byName.get("Lead_Source");
  if (source && source.picklist.length > 0) {
    if (!source.picklist.includes(mapping.instagramSourceValue)) errors.push("Instagram lead source is not an allowed picklist value.");
    if (!source.picklist.includes(mapping.facebookSourceValue)) errors.push("Facebook lead source is not an allowed picklist value.");
  }
  for (const field of fields) {
    if (field.required && field.apiName !== "Last_Name" && !used.includes(field.apiName)) {
      errors.push(`Mandatory field ${field.apiName} is not mapped.`);
    }
  }
  if (!mapping.externalKeyField) errors.push("Configure a unique external lead key before enabling sync.");
  return errors;
}

export function duplicateCheckFields(mapping: ZohoMapping): string[] {
  return mapping.externalKeyField ? [mapping.externalKeyField] : [];
}

export function buildZohoRecord(input: ZohoLeadInput, mapping: ZohoMapping): Record<string, string> {
  const record: Record<string, string> = {
    Last_Name: displayLastName(input),
    Lead_Source: input.channel === "INSTAGRAM" ? mapping.instagramSourceValue : mapping.facebookSourceValue,
  };
  if (mapping.externalKeyField) record[mapping.externalKeyField] = input.leadId;
  if (mapping.phoneField && input.phoneE164) record[mapping.phoneField] = input.phoneE164;
  if (input.city && mapping.cityField) record[mapping.cityField] = input.city;
  if (mapping.projectField && input.projectType) record[mapping.projectField] = input.projectType;
  if (mapping.budgetField && input.budgetRaw) record[mapping.budgetField] = input.budgetRaw;
  if (mapping.timeframeField && input.timeframeRaw) record[mapping.timeframeField] = input.timeframeRaw;
  if (mapping.whatsappField && input.whatsappE164) record[mapping.whatsappField] = input.whatsappE164;
  const description = [
    `Requirement: ${input.requirement ?? "unknown"}`,
    `Channel: ${input.channel}`,
    `Account: ${input.connectionLabel}`,
    `Post: ${input.postId ?? "unattributed"}`,
    `Permission: ${input.permissionSummary}`,
    mapping.whatsappField ? null : `WhatsApp: ${input.whatsappE164 ?? "not provided"}`,
    `Internal lead: ${input.leadId}`,
  ]
    .filter(Boolean)
    .join("\n");
  if (mapping.descriptionFallback) record.Description = description;
  return record;
}

export function shouldCreateAgain(input: { knownCrmId: string | null; lastResult: "SUCCESS" | "UNKNOWN" | "FAILED" | null }): boolean {
  if (input.knownCrmId) return false;
  if (input.lastResult === "UNKNOWN") return false;
  return true;
}

export function revisionIsStale(attemptRevision: number, currentRevision: number): boolean {
  return attemptRevision !== currentRevision;
}
