import { login } from "@/lib/actions";
import { productName } from "@/lib/auth";
import { SnapMark } from "@/components/ui";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; revoked?: string }> }) {
  const params = await searchParams;
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,1fr)]">
      <section className="hidden flex-col justify-between bg-[var(--color-shell)] px-12 py-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <SnapMark size={36} />
          <p className="text-lg font-semibold tracking-tight">{productName}</p>
        </div>
        <div>
          <h1 className="max-w-md text-balance text-[42px] font-semibold leading-[1.05] tracking-tight">Turn a comment into a conversation your team can close.</h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-white/60">One shared inbox for Instagram and Facebook. The assistant asks the questions. Your team takes over when it should.</p>
        </div>
        <p className="text-xs text-white/40">Invitation only</p>
      </section>
      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <SnapMark />
            <p className="font-semibold">{productName}</p>
          </div>
          <h2 className="text-[28px] font-semibold tracking-tight">Sign in</h2>
          <p className="mt-2 text-sm text-[var(--color-muted)]">Use the account from your invitation.</p>
          {params.error ? <p className="mt-4 rounded-xl bg-[#fde8ec] px-3 py-2 text-sm text-[#9f1239]">Those credentials were not accepted.</p> : null}
          {params.revoked ? <p className="mt-4 rounded-xl bg-[#fde8ec] px-3 py-2 text-sm text-[#9f1239]">This session no longer has access.</p> : null}
          <form action={login} className="mt-8 grid gap-4">
            <label>Email<input name="email" type="email" autoComplete="email" required /></label>
            <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
            <button className="mt-1 border-transparent bg-[var(--color-accent)] text-white hover:bg-[#0a655f]" type="submit">Sign in</button>
          </form>
        </div>
      </section>
    </main>
  );
}
