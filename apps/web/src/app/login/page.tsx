import { login } from "@/lib/actions";
import { productName } from "@/lib/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; revoked?: string }> }) {
  const params = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-[400px]">
        <p className="text-sm font-semibold tracking-tight">{productName}</p>
        <h1 className="mt-3 text-balance text-[33px] font-semibold leading-none tracking-tight">Staff sign in</h1>
        <p className="mt-3 text-sm text-[var(--color-muted)]">Invitation only. Public registration is off.</p>
        {params.error ? <p className="mt-4 rounded-lg border border-[#fecdd3] bg-[#fff1f2] px-3 py-2 text-sm text-[#9f1239]">Those credentials were not accepted.</p> : null}
        {params.revoked ? <p className="mt-4 rounded-lg border border-[#fecdd3] bg-[#fff1f2] px-3 py-2 text-sm text-[#9f1239]">This session or account no longer has access.</p> : null}
        <form action={login} className="mt-8 grid gap-4">
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="mt-1 border-transparent bg-[var(--color-accent)] text-white hover:bg-[#115e59]" type="submit">Sign in</button>
        </form>
      </div>
    </main>
  );
}
