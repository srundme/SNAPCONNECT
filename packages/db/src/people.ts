import { randomUUID } from "node:crypto";
import { parseLeadQuestions, profilePersonName } from "@snapsocial/domain";
import type { Db } from "./client";
import type { Prisma } from "./generated/prisma/client";

/**
 * One person can write on Instagram, Facebook and WhatsApp. Meta gives each channel a different id,
 * so contacts are only joined on what the customer told us: the same phone or email (automatic),
 * a staff confirmation, or the customer saying yes to "have we spoken before".
 */

function answers(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0));
}

/** Every contact that is the same person as this one, this one included. */
export async function personContactIds(db: Db, contactId: string): Promise<string[]> {
  const contact = await db.contact.findUnique({ where: { id: contactId }, select: { personId: true } });
  if (!contact?.personId) return [contactId];
  const all = await db.contact.findMany({ where: { personId: contact.personId }, select: { id: true } });
  return all.map((item) => item.id);
}

/** The person's active leads, oldest first. The primary lead is the one Zoho knows. */
export async function personLeads(db: Db, contactId: string) {
  const ids = await personContactIds(db, contactId);
  return db.lead.findMany({
    where: { contactId: { in: ids }, archivedAt: null },
    include: { crm: true, contact: true },
    orderBy: { createdAt: "asc" },
  });
}

/** The lead whose Zoho record every channel of this person updates: the first one already in Zoho, else the oldest. */
export function primaryOf<T extends { createdAt: Date; crm: { crmId: string | null } | null }>(leads: T[]): T | undefined {
  return leads.find((lead) => lead.crm?.crmId) ?? leads[0];
}

/**
 * Shares what the person told us on any channel with every channel: the newest answer wins, a known
 * name and phone fill the gaps. Code then never asks again for something already answered elsewhere.
 * Returns true when anything changed.
 */
export async function mergePersonLeads(db: Db, contactId: string): Promise<boolean> {
  const leads = await personLeads(db, contactId);
  if (leads.length < 2) return false;
  const newestFirst = [...leads].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const merged: Record<string, string> = {};
  for (const lead of [...newestFirst].reverse()) Object.assign(merged, answers(lead.answers));
  const phone = newestFirst.find((lead) => lead.phoneE164)?.phoneE164 ?? null;
  const name = newestFirst.map((lead) => lead.contact.chosenName).find(Boolean) ?? null;
  let changed = false;
  for (const lead of leads) {
    const current = answers(lead.answers);
    const nextAnswers = { ...current, ...merged };
    const answersChanged = JSON.stringify(nextAnswers) !== JSON.stringify(current);
    const phoneChanged = Boolean(phone && !lead.phoneE164);
    if (answersChanged || phoneChanged) {
      changed = true;
      await db.lead.update({
        where: { id: lead.id },
        data: {
          answers: nextAnswers as Prisma.InputJsonValue,
          ...(phoneChanged ? { phoneE164: phone, phonePermission: true } : {}),
          revision: { increment: 1 },
        },
      });
    }
    if (name && !lead.contact.chosenName) {
      changed = true;
      await db.contact.update({ where: { id: lead.contactId }, data: { chosenName: name } });
    }
  }
  return changed;
}

/** Joins two contacts (and everyone already joined to either) into one person, then shares their answers. */
export async function linkContacts(
  db: Db,
  input: { workspaceId: string; contactId: string; otherId: string; evidence: "PHONE" | "EMAIL" | "STAFF" | "CUSTOMER_CONFIRMED"; actorId?: string | null },
): Promise<boolean> {
  if (input.contactId === input.otherId) return false;
  const [one, two] = await Promise.all([
    db.contact.findFirst({ where: { id: input.contactId, workspaceId: input.workspaceId }, select: { id: true, personId: true } }),
    db.contact.findFirst({ where: { id: input.otherId, workspaceId: input.workspaceId }, select: { id: true, personId: true } }),
  ]);
  if (!one || !two) return false;
  if (one.personId && one.personId === two.personId) return false;
  // Staff or the customer said these are different people: automatic phone or email matches never override that.
  if (input.evidence === "PHONE" || input.evidence === "EMAIL") {
    const refused = await db.personMatch.findFirst({
      where: { status: "REJECTED", OR: [{ contactId: one.id, candidateId: two.id }, { contactId: two.id, candidateId: one.id }] },
      select: { id: true },
    });
    if (refused) return false;
    // Same number or email but clearly different names (Riteesh on Instagram, Arvind on WhatsApp): it may be a
    // family member's number, so it is never joined on its own; the team sees it as a possible match instead.
    const [first, second] = await Promise.all([one.id, two.id].map((id) => db.contact.findUnique({ where: { id }, select: { chosenName: true, displayName: true, username: true } })));
    const namesOne = nameTokens(first?.chosenName, first?.displayName, first?.username);
    const namesTwo = nameTokens(second?.chosenName, second?.displayName, second?.username);
    if (namesOne.size && namesTwo.size && ![...namesOne].some((token) => namesTwo.has(token))) {
      const label = (item: typeof first) => item?.chosenName ?? item?.displayName ?? item?.username ?? "unknown";
      await db.personMatch.upsert({
        where: { contactId_candidateId: { contactId: one.id, candidateId: two.id } },
        update: {},
        create: { workspaceId: input.workspaceId, contactId: one.id, candidateId: two.id, score: 3, reasons: `same ${input.evidence === "PHONE" ? "phone number" : "email"}, different names (${label(first)} and ${label(second)})` },
      });
      return false;
    }
  }
  const personId = two.personId ?? one.personId ?? randomUUID();
  const members = [one.id, two.id];
  const groups = [one.personId, two.personId].filter((id): id is string => Boolean(id) && id !== personId);
  await db.contact.updateMany({
    where: { OR: [{ id: { in: members } }, ...(groups.length ? [{ personId: { in: groups } }] : [])] },
    data: { personId },
  });
  await db.personMatch.updateMany({
    where: { OR: [{ contactId: one.id, candidateId: two.id }, { contactId: two.id, candidateId: one.id }] },
    data: { status: "LINKED", decidedBy: input.actorId ?? input.evidence },
  });
  await db.auditEvent.create({
    data: {
      actorId: input.actorId ?? null,
      workspaceId: input.workspaceId,
      action: "person.link",
      entityType: "Contact",
      entityId: one.id,
      summary: `Joined with another channel as the same person (${input.evidence.toLowerCase().replace("_", " ")}).`,
    },
  });
  await mergePersonLeads(db, one.id);
  return true;
}

/** Staff separate a contact that was joined by mistake. Answers already shared stay as they are. */
export async function unlinkContact(db: Db, workspaceId: string, contactId: string, actorId: string): Promise<void> {
  const contact = await db.contact.findFirst({ where: { id: contactId, workspaceId }, select: { personId: true } });
  if (!contact?.personId) return;
  await db.contact.update({ where: { id: contactId }, data: { personId: null } });
  const left = await db.contact.findMany({ where: { personId: contact.personId }, select: { id: true } });
  // Remember the separation so the same phone or email does not join them again.
  for (const other of left) {
    await db.personMatch.upsert({
      where: { contactId_candidateId: { contactId, candidateId: other.id } },
      update: { status: "REJECTED", decidedBy: actorId },
      create: { workspaceId, contactId, candidateId: other.id, score: 0, reasons: "separated by staff", status: "REJECTED", decidedBy: actorId },
    });
  }
  if (left.length === 1) await db.contact.update({ where: { id: left[0]!.id }, data: { personId: null } });
  await db.personMatch.updateMany({
    where: { OR: [{ contactId }, { candidateId: contactId }], status: "LINKED" },
    data: { status: "REJECTED", decidedBy: actorId },
  });
  await db.auditEvent.create({
    data: { actorId, workspaceId, action: "person.unlink", entityType: "Contact", entityId: contactId, summary: "Separated from the other channels." },
  });
}

/** Staff or the customer said these two are not the same person: never suggest or ask again. */
export async function rejectMatch(db: Db, workspaceId: string, matchId: string, decidedBy: string): Promise<void> {
  await db.personMatch.updateMany({ where: { id: matchId, workspaceId }, data: { status: "REJECTED", decidedBy } });
}

function emailOf(questions: ReturnType<typeof parseLeadQuestions>, record: Record<string, string>): string | null {
  const question = questions.find((item) => /e-?mail|\bmail\b/i.test(item.label));
  const value = question ? record[question.id]?.trim().toLowerCase() : "";
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

/**
 * Joins this contact to any other contact in the workspace that gave the same phone number or
 * email. Both are things only the customer could have told us, so the link is automatic.
 */
export async function linkByPhoneOrEmail(db: Db, workspaceId: string, contactId: string): Promise<boolean> {
  const own = await personContactIds(db, contactId);
  const lead = await db.lead.findFirst({ where: { contactId, archivedAt: null }, orderBy: { createdAt: "desc" } });
  if (!lead) return false;
  let linked = false;
  if (lead.phoneE164) {
    const samePhone = await db.lead.findMany({
      where: { workspaceId, archivedAt: null, phoneE164: lead.phoneE164, contactId: { notIn: own }, testRecord: lead.testRecord },
      select: { contactId: true },
      take: 5,
    });
    for (const other of samePhone) linked = (await linkContacts(db, { workspaceId, contactId, otherId: other.contactId, evidence: "PHONE" })) || linked;
  }
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { leadQuestions: true } });
  const questions = parseLeadQuestions(workspace?.leadQuestions);
  const email = emailOf(questions, answers(lead.answers));
  const emailQuestion = questions.find((item) => /e-?mail|\bmail\b/i.test(item.label));
  if (email && emailQuestion) {
    const candidates = await db.lead.findMany({
      where: { workspaceId, archivedAt: null, contactId: { notIn: await personContactIds(db, contactId) }, testRecord: lead.testRecord, answers: { path: [emailQuestion.id], string_contains: email.split("@")[0]! } },
      select: { contactId: true, answers: true },
      take: 10,
    });
    for (const other of candidates) {
      if (emailOf(questions, answers(other.answers)) !== email) continue;
      linked = (await linkContacts(db, { workspaceId, contactId, otherId: other.contactId, evidence: "EMAIL" })) || linked;
    }
  }
  return linked;
}

const NAME_STOP = new Set(["the", "and", "sir", "mam", "official", "home", "homes", "interiors"]);

function nameTokens(...values: Array<string | null | undefined>): Set<string> {
  const tokens = new Set<string>();
  for (const value of values) {
    const readable = profilePersonName(value, null) ?? profilePersonName(null, value) ?? value ?? "";
    for (const token of readable.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/)) {
      if (token.length >= 3 && !NAME_STOP.has(token)) tokens.add(token);
    }
  }
  return tokens;
}

function placeKey(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\b(bengaluru|bangalore|blr|karnataka|india)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 2)
    .slice(0, 3)
    .join(" ");
}

function bhkOf(value: string | undefined): string | null {
  return value?.match(/(?<!\d)([1-9])\s*-?\s*bhk\b/i)?.[1] ?? null;
}

/**
 * Looks for the same person on another channel when they gave no phone or email: a matching name,
 * the same project, the same size, a recent chat. A weak match is only a suggestion for staff; it is
 * never joined on its own, because two people can share a name.
 * Returns the strongest open suggestion, if any.
 */
export async function suggestMatches(db: Db, input: { workspaceId: string; contactId: string; channel: string; now: Date }) {
  const contact = await db.contact.findUnique({ where: { id: input.contactId } });
  if (!contact) return null;
  const own = await personContactIds(db, input.contactId);
  const lead = await db.lead.findFirst({ where: { contactId: input.contactId, archivedAt: null }, orderBy: { createdAt: "desc" } });
  const workspace = await db.workspace.findUnique({ where: { id: input.workspaceId }, select: { leadQuestions: true } });
  const questions = parseLeadQuestions(workspace?.leadQuestions);
  const placeQuestion = questions.find((item) => /\b(where is the home|which area|location)\b/i.test(item.label));
  const homeQuestion = questions.find((item) => /\bbhk\b/i.test(item.label));
  const mine = answers(lead?.answers);
  const myNames = nameTokens(contact.chosenName, contact.displayName, contact.username);
  const myPlace = placeKey(placeQuestion ? mine[placeQuestion.id] : undefined);
  const myBhk = bhkOf(homeQuestion ? mine[homeQuestion.id] : undefined);
  if (!myNames.size && !myPlace) return null;
  const since = new Date(input.now.getTime() - 14 * 86_400_000);
  const others = await db.contact.findMany({
    where: {
      workspaceId: input.workspaceId,
      id: { notIn: own },
      channel: { not: contact.channel as never },
      conversations: { some: { updatedAt: { gte: since }, sandbox: false } },
    },
    include: {
      leads: { where: { archivedAt: null }, orderBy: { createdAt: "desc" }, take: 1 },
      conversations: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
    },
    take: 200,
  });
  const decided = await db.personMatch.findMany({
    where: { contactId: input.contactId, status: { in: ["REJECTED", "LINKED"] } },
    select: { candidateId: true },
  });
  const skip = new Set(decided.map((item) => item.candidateId));
  let best: { id: string; score: number } | null = null;
  for (const other of others) {
    if (skip.has(other.id) || (other.personId && other.personId === contact.personId)) continue;
    // Archived test copies from chat resets are never matched.
    if (/\(old test/i.test(`${other.username ?? ""} ${other.displayName ?? ""}`)) continue;
    const theirs = answers(other.leads[0]?.answers);
    const reasons: string[] = [];
    let score = 0;
    const theirNames = nameTokens(other.chosenName, other.displayName, other.username);
    const shared = [...myNames].filter((token) => theirNames.has(token));
    if (shared.length >= 2) { score += 3; reasons.push("same full name"); }
    else if (shared.length === 1) { score += 2; reasons.push("same name"); }
    const theirPlace = placeKey(placeQuestion ? theirs[placeQuestion.id] : undefined);
    if (myPlace && theirPlace && (myPlace === theirPlace || myPlace.includes(theirPlace) || theirPlace.includes(myPlace))) { score += 2; reasons.push("same project"); }
    const theirBhk = bhkOf(homeQuestion ? theirs[homeQuestion.id] : undefined);
    if (myBhk && theirBhk && myBhk === theirBhk) { score += 1; reasons.push(`same size (${myBhk} BHK)`); }
    const last = other.conversations[0]?.updatedAt;
    if (last && input.now.getTime() - last.getTime() < 3 * 86_400_000) { score += 1; reasons.push("chatted in the last 3 days"); }
    // A name alone, a project alone or a recent chat alone is never enough: the name has to come with the
    // same project or size, or the project with the size.
    const sameProject = reasons.includes("same project");
    const sameSize = reasons.some((reason) => reason.startsWith("same size"));
    const strongEnough = (shared.length > 0 && (sameProject || sameSize)) || (sameProject && sameSize);
    if (!strongEnough) continue;
    await db.personMatch.upsert({
      where: { contactId_candidateId: { contactId: input.contactId, candidateId: other.id } },
      update: { score, reasons: reasons.join(", ") },
      create: { workspaceId: input.workspaceId, contactId: input.contactId, candidateId: other.id, score, reasons: reasons.join(", ") },
    });
    if (!best || score > best.score) best = { id: other.id, score };
  }
  return best;
}

/** Channels this person also used, for the reply prompt and the inbox. */
export async function otherChannelsOf(db: Db, contactId: string): Promise<Array<{ contactId: string; channel: string }>> {
  const ids = await personContactIds(db, contactId);
  const others = await db.contact.findMany({ where: { id: { in: ids.filter((id) => id !== contactId) } }, select: { id: true, channel: true } });
  return others.map((item) => ({ contactId: item.id, channel: item.channel }));
}
