import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "@/components/site/site-shell";
import { SITE } from "@/lib/site";

/**
 * Where a shared invite link lands in a browser. The session itself is private to
 * signed-in members, so this page shows nothing about it — it hands the code to
 * the app, which resolves it.
 */
export const Route = createFileRoute("/invite/$code")({
  head: () => ({
    meta: [{ title: "You’re invited — SamePace" }, { name: "robots", content: "noindex" }],
  }),
  component: Invite,
});

function Invite() {
  const { code } = Route.useParams();
  const safe = /^[A-Za-z0-9_-]{4,64}$/.test(code) ? code : null;

  return (
    <SiteShell>
      <section className="mx-auto max-w-xl py-10">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-accent">
          Invite-only session
        </p>
        <h1 className="mt-3 text-balance text-[34px] font-semibold leading-[1.1] tracking-tight">
          Someone you know opened a seat for you.
        </h1>
        <p className="mt-4 text-pretty text-base leading-relaxed text-muted">
          The time, the place and the level are in the app. Joining is free; the exact meeting spot
          unlocks once you’re in.
        </p>

        {safe ? (
          <a
            href={`${SITE.appScheme}://invite/${safe}`}
            className="press mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-fg px-6 text-[15px] font-medium text-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stand"
          >
            Open in {SITE.name}
          </a>
        ) : (
          <p className="glass mt-8 rounded-2xl px-4 py-3 text-sm text-muted" role="alert">
            This invite link is incomplete. Ask for it again.
          </p>
        )}

        <p className="mt-6 text-pretty text-sm leading-relaxed text-muted">
          Nothing happened when you tapped? {SITE.name} is in private testing for iPhone and Android —
          ask the person who invited you to get you on the list, then open this link again.
        </p>
      </section>
    </SiteShell>
  );
}
