import { SITE } from "@/lib/site";

/** The web prototype has no authenticated agent-history feed. Do not substitute demo messages. */
export function AgentChatsHandoff() {
  return (
    <section className="glass mt-5 rounded-2xl p-5">
      <h2 className="text-lg font-semibold tracking-tight">Your agents handle the conversation</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Open SamePace on your iPhone to follow your agent&apos;s conversations with potential
        workout partners&apos; agents and review proposed plans.
      </p>
      <p className="mt-2 text-xs text-faint">
        Live agent history is available in the app. This web demo does not load your account&apos;s
        conversations.
      </p>
      <a
        href={`${SITE.appScheme}://inbox`}
        className="press mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-fg px-5 text-[15px] font-medium text-bg"
      >
        Open Chats on iPhone
      </a>
    </section>
  );
}
