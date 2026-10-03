import { productName } from "@/lib/auth";

export default function DataDeletionPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-sm">
      <h1 className="text-2xl font-semibold">Data deletion</h1>
      <p className="mt-4">{productName} accepts deletion requests from an authenticated workspace admin. Send the workspace name and the channel contact reference to the operator who invited you. The deletion job removes that contact's transcript, notes and lead fields, cancels pending outreach and CRM sync, and writes an audit summary without the deleted content.</p>
      <p className="mt-3">A request for one workspace does not delete another client's records. This page describes the product behaviour and is not a regulatory certificate.</p>
    </main>
  );
}
