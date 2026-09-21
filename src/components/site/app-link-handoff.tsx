import { SiteShell } from "@/components/site/site-shell";
import { SITE } from "@/lib/site";

/** Public landing only: the member's app resolves access after signing in. */
export function AppLinkHandoff({
  kind,
  id,
  invite,
}: {
  kind: "session" | "training-block";
  id: string;
  invite?: string;
}) {
  const safe = /^[A-Za-z0-9_-]{1,128}$/.test(id);
  return (
    <SiteShell>
      <section className="mx-auto max-w-xl py-10">
        <h1 className="text-balance text-[34px] font-semibold leading-[1.1] tracking-tight">
          Open this {kind === "session" ? "workout" : "training goal"} in SamePace.
        </h1>
        <p className="mt-4 text-pretty text-base leading-relaxed text-muted">
          Sign in in the app to see the details you have access to.
        </p>
        {safe ? (
          <a
            href={`${SITE.appScheme}://${kind}/${id}${invite && /^[A-Za-z0-9_-]{4,64}$/.test(invite) ? `?invite=${invite}` : ""}`}
            className="press mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-fg px-6 text-[15px] font-medium text-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stand"
          >
            Open in {SITE.name}
          </a>
        ) : (
          <p role="alert" className="mt-8 text-sm text-muted">
            This link is incomplete. Ask the sender for a new one.
          </p>
        )}
        <p className="mt-6 text-pretty text-sm leading-relaxed text-muted">
          SamePace is in private testing. If you do not have the app yet, ask the sender about
          joining, then reopen the original link.
        </p>
      </section>
    </SiteShell>
  );
}
