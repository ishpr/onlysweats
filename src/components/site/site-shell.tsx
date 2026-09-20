import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PaceMark, PaceWordmark } from "@/components/icons";
import { SITE } from "@/lib/site";

const FOOTER = [
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/support", label: "Support" },
] as const;

const linkClass =
  "inline-flex min-h-11 items-center rounded-full px-3 text-sm text-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stand";

/** Chrome for the public site: landing, policies, support, invite links. */
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 md:px-6">
      <header className="flex items-center justify-between py-4">
        <Link
          to="/"
          aria-label={`${SITE.name} home`}
          className="flex min-h-11 items-center gap-2 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stand"
        >
          <PaceMark className="size-7" />
          <PaceWordmark className="text-[17px]" />
        </Link>
        <nav aria-label="Site">
          <Link to="/support" className={linkClass}>
            Support
          </Link>
        </nav>
      </header>

      <main className="flex-1 pb-16 pt-6">{children}</main>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-fg/10 py-6">
        <p className="text-sm text-faint">© 2026 {SITE.name}</p>
        <nav aria-label="Legal" className="flex flex-wrap">
          {FOOTER.map((f) => (
            <Link key={f.to} to={f.to} className={linkClass}>
              {f.label}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  );
}

/** Long-form page (policies, support): a title, a dated line, readable prose. */
export function Prose({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-2xl">
      <h1 className="text-balance text-[34px] font-semibold leading-[1.1] tracking-tight">{title}</h1>
      {lede && <p className="mt-3 text-pretty text-base leading-relaxed text-muted">{lede}</p>}
      <div className="mt-8 flex flex-col gap-8">{children}</div>
    </article>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-pretty text-base leading-relaxed text-muted [&_li]:ml-5 [&_li]:list-disc [&_strong]:font-medium [&_strong]:text-fg [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2">
        {children}
      </div>
    </section>
  );
}

/** The contact line: support@samepace.app, routed by Cloudflare Email Routing. */
export function SupportEmail() {
  return (
    <a
      href={`mailto:${SITE.supportEmail}`}
      className="rounded font-medium text-fg underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stand"
    >
      {SITE.supportEmail}
    </a>
  );
}
