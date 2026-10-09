export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-sm">
      <h1 className="text-2xl font-semibold">The KariGhars privacy notice</h1>
      <p className="mt-4">This internal tool stores staff accounts and, for connected workspaces, comments, direct messages, contact details the person chooses to share, and CRM sync status. It is not a legal certification.</p>
      <p className="mt-3">Tokens are encrypted at rest. Routine logs omit secrets, phone numbers and transcripts. Instagram and Facebook identities are kept separate.</p>
      <p className="mt-3">To ask for deletion of a conversation or lead, use the signed-in deletion action or the data-deletion page. Deletion suppresses queued messages and CRM writes for that contact and does not affect another workspace.</p>
    </main>
  );
}
