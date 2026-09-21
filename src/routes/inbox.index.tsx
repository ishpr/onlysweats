import { createFileRoute, Link } from "@tanstack/react-router";
import { Avatar } from "@/components/ui/avatar";
import { AgentChatsHandoff } from "@/components/agent-chats-handoff";
import { personById } from "@/lib/seed";
import { usePaceStore } from "@/lib/store";
import { When } from "@/components/when";
import { ME_ID } from "@/lib/types";

export const Route = createFileRoute("/inbox/")({ component: Inbox });

function Inbox() {
  const bookings = usePaceStore((s) => s.bookings);
  const sessions = usePaceStore((s) => s.sessions);
  const messages = usePaceStore((s) => s.messages);

  const threads = bookings
    .filter(
      (b) =>
        b.participantId === ME_ID || sessions.find((s) => s.id === b.sessionId)?.hostId === ME_ID,
    )
    .filter((b) => messages.some((message) => message.bookingId === b.id))
    .map((b) => {
      const session = sessions.find((s) => s.id === b.sessionId);
      const otherId = b.participantId === ME_ID ? session?.hostId : b.participantId;
      const last = messages.filter((m) => m.bookingId === b.id).at(-1);
      return { booking: b, session, otherId, last };
    })
    .filter((row) => row.session)
    .sort(
      (a, b) =>
        +new Date(b.last?.createdAt ?? b.booking.createdAt) -
        +new Date(a.last?.createdAt ?? a.booking.createdAt),
    );

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-[32px] font-semibold tracking-tight">Chats</h1>
      <p className="mt-1 text-sm text-muted">
        Follow your agent&apos;s planning conversations. Review plans when they are ready.
      </p>
      <AgentChatsHandoff />
      {threads.length > 0 && (
        <details className="mt-6">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">
            Legacy demo messages
          </summary>
          <p className="mb-2 text-xs leading-relaxed text-faint">
            Read-only examples from the earlier member messaging demo. These are simulated human
            messages, not conversations between agents.
          </p>
          <div className="flex flex-col gap-1">
            {threads.map(({ booking, session, otherId, last }) => {
              const other = otherId ? personById(otherId) : undefined;
              return (
                <Link
                  key={booking.id}
                  to="/inbox/$id"
                  params={{ id: booking.id }}
                  className="flex items-center gap-3 rounded-2xl px-2 py-3 hover:bg-fg/6"
                >
                  {other && <Avatar initials={other.initials} accent={other.accent} />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-medium tracking-tight">{other?.name ?? "Former member"}</p>
                      {session && (
                        <span className="text-[11px] text-faint">
                          <When iso={session.startAt} />
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm text-muted">{last?.text}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
