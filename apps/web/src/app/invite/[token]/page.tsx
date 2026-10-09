import { acceptInvite } from "@/lib/actions";

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const query = await searchParams;
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">Accept invitation</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">This link works once. Choose a password of at least 12 characters.</p>
      {query.error ? <p className="mt-3 text-sm text-rose-800">{query.error === "auth" ? "This email already has an account. Enter its current password." : "Use a longer password."}</p> : null}
      <form action={acceptInvite} className="mt-6 grid gap-3 text-sm">
        <input type="hidden" name="token" value={token} />
        <input name="name" required placeholder="Your name" className="border border-[var(--color-line)] px-2 py-2" />
        <input name="password" type="password" required minLength={12} placeholder="Password" className="border border-[var(--color-line)] px-2 py-2" />
        <button className="bg-[var(--color-accent)] px-3 py-2 text-white" type="submit">Create staff access</button>
      </form>
    </main>
  );
}
