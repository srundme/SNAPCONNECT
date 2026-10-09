import { CircleAlert } from "lucide-react";
import { login } from "@/lib/actions";
import { BrandMark } from "@/components/ui";

function errorText(error?: string, revoked?: string) {
  if (revoked) return "This account no longer has access. Ask your admin if you think this is a mistake.";
  if (error === "invite") return "That invitation link has expired or was already used. Ask your admin for a new one.";
  if (error) return "That email and password did not match. Check them and try again.";
  return null;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; revoked?: string }> }) {
  const params = await searchParams;
  const error = errorText(params.error, params.revoked);
  return (
    <main className="grid min-h-dvh bg-[var(--color-paper)] lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,1fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-[var(--color-shell)] px-12 py-10 text-white lg:flex">
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(141,107,47,0.28),transparent)]" />
        <BrandMark height={96} className="relative" />
        <div className="relative">
          <span className="mb-6 block h-px w-14 bg-[var(--color-accent)]" aria-hidden />
          <h1 className="max-w-md text-balance font-[family-name:var(--font-display)] text-[54px] font-medium leading-[1.02] tracking-tight">Illuminating radiance within.</h1>
          <p className="mt-5 max-w-sm text-sm leading-6 text-white/60">Home interiors, from the first message. Varun takes the enquiry. The team takes it from there.</p>
        </div>
        <p className="relative text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">Bengaluru · By invitation</p>
      </section>

      <section className="flex flex-col">
        <div className="flex items-center justify-center bg-[var(--color-shell)] px-6 py-6 lg:hidden">
          <BrandMark height={72} />
        </div>
        <div className="flex flex-1 items-center justify-center px-5 py-12 sm:px-6 sm:py-16">
          <div className="w-full max-w-[400px]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">Team console</p>
            <h2 className="mt-2 font-[family-name:var(--font-display)] text-[40px] font-medium leading-none tracking-tight">Welcome back</h2>
            <p className="mt-3 text-sm text-[var(--color-muted)]">Sign in with the email from your invitation.</p>

            {error ? (
              <div role="alert" className="mt-6 flex items-start gap-2.5 rounded-xl border border-[#f7c9d3] bg-[#fdf0f3] px-3.5 py-3 text-sm text-[#9f1239]">
                <CircleAlert size={17} aria-hidden className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <form action={login} className="mt-7 grid gap-4 rounded-2xl bg-white p-5 shadow-[var(--shadow-lift)] sm:p-6">
              <label>
                Email
                <input name="email" type="email" autoComplete="email" inputMode="email" required autoFocus aria-invalid={error && !params.revoked ? true : undefined} />
              </label>
              <label>
                Password
                <input name="password" type="password" autoComplete="current-password" required aria-invalid={error && !params.revoked ? true : undefined} />
              </label>
              <button className="mt-1 border-transparent bg-[var(--color-accent)] py-3 text-[15px] text-white hover:bg-[#745722]" type="submit">Sign in</button>
            </form>
            <p className="mt-6 text-center text-[12px] text-[var(--color-muted)]">Need access? Ask your admin for an invitation.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
