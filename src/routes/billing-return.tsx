import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { SiteShell } from "@/components/site/site-shell";
import { SITE } from "@/lib/site";

export const Route = createFileRoute("/billing-return")({
  head: () => ({
    meta: [
      { title: "Back to SamePace" },
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: BillingReturn,
});

/** Provider query parameters never decide payment or appear in the app handoff. */
function BillingReturn() {
  const back = `${SITE.appScheme}://billing-return`;
  useEffect(() => {
    window.location.replace(back);
  }, [back]);
  return (
    <SiteShell>
      <section className="mx-auto max-w-xl py-10">
        <h1 className="text-balance text-[34px] font-semibold leading-[1.1] tracking-tight">
          Return to SamePace.
        </h1>
        <p className="mt-4 text-pretty text-base leading-relaxed text-muted">
          The app will securely check your membership and fee status when you return.
        </p>
        <a
          href={back}
          className="press mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-fg px-6 text-[15px] font-medium text-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stand"
        >
          Return to {SITE.name}
        </a>
        <p className="mt-6 text-pretty text-sm leading-relaxed text-muted">
          If the app does not open, open SamePace and go to Membership &amp; fees to refresh your
          status.
        </p>
      </section>
    </SiteShell>
  );
}
