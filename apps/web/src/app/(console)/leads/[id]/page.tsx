import Link from "next/link";
import { ArrowLeft, ExternalLink, Link2, Mail, MessageCircle, MessagesSquare, Phone } from "lucide-react";
import { parseLeadQuestions } from "@snapsocial/domain";
import { notFound } from "next/navigation";
import { getPrisma, personLeads, primaryOf } from "@snapsocial/db";
import { deleteLeadContact } from "@/lib/actions";
import { ChannelMark } from "@/components/ui";
import { RatingChip, StatusChip } from "@/components/leads/chips";
import { ActionLink, Card, Field } from "@/components/leads/detail-parts";
import { answersOf, leadName, leadStatus, ownerLabel, ratingOf, shortLabel, zohoLeadUrl } from "@/components/leads/lead-data";
import { fullIST, whenIST } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";

const CRM_STATE: Record<string, string> = {
  NOT_READY: "Not sent yet — waiting for the required details",
  PENDING: "Queued to send",
  SYNCED: "In Zoho",
  RETRYING: "Retrying",
  NEEDS_ATTENTION: "Needs attention",
};

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace, role } = await requireWorkspace();
  if (!workspace || role === "VIEWER") notFound();
  const db = getPrisma();
  const lead = await db.lead.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { contact: true, crm: true },
  });
  if (!lead) notFound();
  // Every channel this person wrote on. Zoho knows one lead for all of them: the primary.
  const [personAll, channelContacts] = await Promise.all([
    personLeads(db, lead.contactId),
    lead.contact.personId
      ? db.contact.findMany({
        where: { workspaceId: workspace.id, personId: lead.contact.personId },
        select: {
          id: true,
          channel: true,
          conversations: { orderBy: { updatedAt: "desc" }, take: 1, select: { id: true, updatedAt: true, lastUserMessageAt: true } },
        },
        orderBy: { createdAt: "asc" },
      })
      : Promise.resolve([]),
  ]);
  const person = personAll.filter((item) => item.workspaceId === workspace.id);
  const primary = primaryOf(person) ?? lead;
  const multiChannel = channelContacts.length > 1;
  const olderZoho = person.filter((item) => item.id !== primary.id && item.crm?.crmId && item.crm.crmId !== primary.crm?.crmId);
  const [conversation, lastSync, zoho] = await Promise.all([
    db.conversation.findFirst({
      where: { workspaceId: workspace.id, contactId: lead.contactId },
      orderBy: { updatedAt: "desc" },
      include: { messages: { orderBy: { createdAt: "desc" }, take: 5 } },
    }),
    db.crmSyncAttempt.findFirst({ where: { leadId: primary.id }, orderBy: { createdAt: "desc" } }),
    db.zohoConnection.findUnique({ where: { workspaceId: workspace.id }, select: { apiDomain: true } }),
  ]);
  const userIds = [conversation?.ownerUserId, ...(conversation?.messages.map((message) => message.staffUserId) ?? [])].filter((value): value is string => Boolean(value));
  const users = new Map((userIds.length ? await db.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, name: true } }) : []).map((user) => [user.id, user.name]));

  const agentName = workspace.agentName?.trim() || "Assistant";
  const name = leadName(lead.contact);
  const profileName = lead.contact.displayName ?? lead.contact.username;
  const questions = parseLeadQuestions(workspace.leadQuestions);
  const answers = answersOf(lead.answers);
  const status = leadStatus(lead);
  const rating = ratingOf(lead.rating);
  const owner = ownerLabel(conversation, agentName, users);
  const emailQuestion = questions.find((question) => shortLabel(question) === "Email");
  const email = lead.email ?? (emailQuestion ? answers[emailQuestion.id] : undefined) ?? null;
  const waNumber = (lead.whatsappE164 ?? lead.phoneE164)?.replace(/\D/g, "") || null;
  const zohoUrl = primary.crm?.crmId && !primary.crm.simulated ? zohoLeadUrl(primary.crm.crmId, zoho?.apiDomain) : null;
  const canDelete = role === "ADMIN" || role === "SUPER_ADMIN";
  const messages = [...(conversation?.messages ?? [])].reverse();

  const answerFor = (question: (typeof questions)[number]): string | null => {
    if (question.kind === "name") return lead.contact.chosenName ?? answers[question.id] ?? null;
    if (question.kind === "phone") return lead.phoneE164 ?? answers[question.id] ?? null;
    if (question === emailQuestion) return email;
    return answers[question.id] ?? null;
  };
  const answeredCount = questions.filter((question) => answerFor(question)).length;

  const authorLabel = (author: string, staffUserId: string | null) =>
    author === "PROSPECT" ? name : author === "AI" ? agentName : author === "STAFF" ? (staffUserId && users.get(staffUserId)) || "Team" : "System";

  return (
    <section className="mx-auto max-w-6xl">
      <Link href="/leads" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-muted)] hover:text-[var(--color-accent-ink)]">
        <ArrowLeft size={14} aria-hidden /> All leads
      </Link>

      {/* Header */}
      <header className="mb-6 rounded-2xl bg-white px-5 py-5 shadow-[0_1px_0_rgba(20,23,28,0.06)] sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-balance break-words font-[family-name:var(--font-display)] text-[34px] font-medium leading-tight tracking-tight">{name}</h1>
            {profileName && profileName !== name ? <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">Profile: {profileName}</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              {multiChannel
                ? [...new Set(channelContacts.map((item) => item.channel))].map((channel) => <ChannelMark key={channel} channel={channel} />)
                : <ChannelMark channel={lead.channel} />}
              <RatingChip rating={rating} reason={lead.ratingReason} />
              <StatusChip status={status} />
            </div>
            {lead.ratingReason ? <p className="mt-3 max-w-2xl text-pretty text-sm text-[var(--color-muted)]">{lead.ratingReason}</p> : null}
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            {conversation ? (
              <Link href={`/inbox?id=${conversation.id}`} className="inline-flex items-center gap-2 rounded-[10px] bg-[var(--color-ink)] px-3.5 py-2 text-sm font-semibold text-white hover:bg-black">
                <MessagesSquare size={15} aria-hidden /> Open conversation
              </Link>
            ) : null}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:text-right">
              <dt className="text-[var(--color-muted)]">Owner</dt><dd className="font-semibold">{owner}</dd>
              <dt className="text-[var(--color-muted)]">First seen</dt><dd>{whenIST(lead.createdAt)}</dd>
              <dt className="text-[var(--color-muted)]">Last update</dt><dd>{whenIST(lead.updatedAt)}</dd>
            </dl>
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-5">
          <Card title="Details collected" action={questions.length ? <span className="text-[12px] text-[var(--color-muted)]">{answeredCount} of {questions.length}</span> : null}>
            {questions.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">No lead questions are set up for this workspace yet. Add them on the Agent page.</p>
            ) : (
              <dl className="divide-y divide-[var(--color-line)]">
                {questions.map((question) => {
                  const value = answerFor(question);
                  return (
                    <div key={question.id} title={question.label}>
                      <Field label={shortLabel(question)} muted={!value}>{value ?? "Not asked yet"}</Field>
                    </div>
                  );
                })}
              </dl>
            )}
          </Card>

          <Card title="Recent activity" action={conversation ? <Link href={`/inbox?id=${conversation.id}`} className="text-[13px] font-semibold text-[var(--color-accent-ink)] hover:underline">Full conversation</Link> : null}>
            {messages.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">No messages yet.</p>
            ) : (
              <ol className="grid gap-4">
                {messages.map((message) => (
                  <li key={message.id} className="grid gap-1">
                    <div className="flex items-baseline justify-between gap-3 text-[12px]">
                      <span className={message.author === "PROSPECT" ? "font-semibold" : "font-semibold text-[var(--color-accent-ink)]"}>{authorLabel(message.author, message.staffUserId)}</span>
                      <span className="shrink-0 tabular-nums text-[var(--color-muted)]">{whenIST(message.createdAt)}</span>
                    </div>
                    <p className={message.author === "PROSPECT" ? "line-clamp-4 whitespace-pre-wrap break-words rounded-xl bg-[var(--color-paper)] px-3 py-2 text-sm" : "line-clamp-4 whitespace-pre-wrap break-words rounded-xl border border-[var(--color-line)] px-3 py-2 text-sm"}>
                      {message.voice && !message.body ? "Voice note" : message.body}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-5">
          <Card title="Contact">
            <dl className="divide-y divide-[var(--color-line)]">
              <Field label="Phone" muted={!lead.phoneE164}>{lead.phoneE164 ? <a href={`tel:${lead.phoneE164}`} className="tabular-nums hover:text-[var(--color-accent-ink)]">{lead.phoneE164}</a> : "Not shared yet"}</Field>
              <Field label="Email" muted={!email}>{email ? <a href={`mailto:${email}`} className="hover:text-[var(--color-accent-ink)]">{email}</a> : "Not shared yet"}</Field>
            </dl>
            {lead.phoneE164 || waNumber || email ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {lead.phoneE164 ? <ActionLink href={`tel:${lead.phoneE164}`} icon={<Phone size={14} aria-hidden />}>Call</ActionLink> : null}
                {waNumber ? <ActionLink href={`https://wa.me/${waNumber}`} external icon={<MessageCircle size={14} aria-hidden className="text-[var(--color-wa)]" />}>WhatsApp</ActionLink> : null}
                {email ? <ActionLink href={`mailto:${email}`} icon={<Mail size={14} aria-hidden />}>Email</ActionLink> : null}
              </div>
            ) : null}
          </Card>

          {multiChannel ? (
            <Card title="Channels" action={<Link2 size={14} aria-hidden className="text-[var(--color-accent)]" />}>
              <ul className="divide-y divide-[var(--color-line)]">
                {channelContacts.map((item) => {
                  const chat = item.conversations[0];
                  const last = chat?.lastUserMessageAt ?? chat?.updatedAt ?? null;
                  return (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <ChannelMark channel={item.channel} />
                        <p className="mt-1 text-[12px] text-[var(--color-muted)]">{last ? `Last chatted ${whenIST(last)}` : "No chat yet"}{item.id === lead.contactId ? " · this lead" : ""}</p>
                      </div>
                      {chat ? (
                        <Link href={`/inbox?id=${chat.id}`} className="shrink-0 text-[13px] font-semibold text-[var(--color-accent-ink)] hover:underline underline-offset-2">Open chat</Link>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-[12px] leading-4 text-[var(--color-muted)]">Same person on every channel. Answers are shared across these chats.</p>
            </Card>
          ) : null}

          <Card title="Zoho CRM" action={multiChannel ? <span className="text-[12px] font-semibold text-[var(--color-accent-ink)]">One Zoho lead for all channels</span> : null}>
            <dl className="divide-y divide-[var(--color-line)]">
              <Field label="Status">{primary.crm?.simulated ? "Simulated (not in real Zoho)" : CRM_STATE[primary.crmState] ?? primary.crmState}</Field>
              <Field label="Last sync" muted={!lastSync}>
                {lastSync ? (
                  <span title={lastSync.error ?? undefined}>
                    {fullIST(lastSync.createdAt)}
                    <span className="block text-[12px] font-normal text-[var(--color-muted)]">{/fail|error/i.test(lastSync.status) ? "Last attempt failed" : lastSync.status.charAt(0) + lastSync.status.slice(1).toLowerCase()}</span>
                  </span>
                ) : "Never sent"}
              </Field>
            </dl>
            {zohoUrl ? <div className="mt-3"><ActionLink href={zohoUrl} external icon={<ExternalLink size={14} aria-hidden />}>Open in Zoho</ActionLink></div> : null}
            {multiChannel && primary.id !== lead.id ? (
              <p className="mt-3 text-[12px] leading-4 text-[var(--color-muted)]">
                Zoho is updated through the {primary.channel === "WHATSAPP" ? "WhatsApp" : primary.channel === "INSTAGRAM" ? "Instagram" : "Facebook"} lead.{" "}
                <Link href={`/leads/${primary.id}`} className="font-semibold text-[var(--color-accent-ink)] hover:underline underline-offset-2">Open it</Link>
              </p>
            ) : null}
            {olderZoho.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {olderZoho.map((item) => {
                  const crmId = item.crm!.crmId!;
                  const url = item.crm?.simulated ? null : zohoLeadUrl(crmId, zoho?.apiDomain);
                  return (
                    <li key={item.id} className="rounded-lg bg-[#fff6e8] px-2.5 py-2 text-[12.5px] leading-[1.35] text-[#92400e]">
                      Also in Zoho as{" "}
                      {url ? <a href={url} target="_blank" rel="noreferrer" className="break-all font-semibold underline underline-offset-2">{crmId}</a> : <span className="break-all font-semibold">{crmId}</span>}{" "}
                      (created before the chats were joined) — merge in Zoho
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </Card>
        </div>
      </div>

      {canDelete ? (
        <details className="group mt-10 rounded-2xl border border-dashed border-[var(--color-line)] px-5 py-3 text-sm">
          <summary className="cursor-pointer select-none text-[13px] font-semibold text-[var(--color-muted)] marker:text-[var(--color-line)]">Danger zone</summary>
          <form action={deleteLeadContact} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <input type="hidden" name="contactId" value={lead.contactId} />
            <p className="max-w-xl text-[13px] text-[var(--color-muted)]">Permanently removes this person&apos;s messages, answers and lead record from SnapConnect. Zoho is not changed. This cannot be undone.</p>
            <button className="shrink-0 border-rose-200 text-rose-800 hover:!bg-rose-50" type="submit">Delete contact data</button>
          </form>
        </details>
      ) : null}
    </section>
  );
}
