import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { SiteShell } from "@/components/site/site-shell";
import { SITE } from "@/lib/site";

/**
 * Where Persona sends a member when they finish an identity check. Nothing about
 * the check is on this page or in its URL that we read: it only hands back to the
 * app, which asks the server how it came out.
 */
export const Route = createFileRoute("/verified")({
  head: () => ({
    meta: [{ title: `Back to the app — ${SITE.name}` }, { name: "robots", content: "noindex" }],
  }),
  component: Verified,
});

function Verified() {
  const back = `${SITE.appScheme}://verified`;
  useEffect(() => {
    window.location.replace(back);
  }, [back]);

  return (
    <SiteShell>
      <section className="mx-auto max-w-xl py-10">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-accent">
          Identity check
        </p>
        <h1 className="mt-3 text-balance text-[34px] font-semibold leading-[1.1] tracking-tight">
          That’s everything. Back to {SITE.name}.
        </h1>
        <p className="mt-4 text-pretty text-base leading-relaxed text-muted">
          The app will show how it came out — usually within a minute. {SITE.name} never sees your
          photo or your ID, only the result.
        </p>
        <a
          href={back}
          className="press mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-fg px-6 text-[15px] font-medium text-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stand"
        >
          Open {SITE.name}
        </a>
      </section>
    </SiteShell>
  );
}
