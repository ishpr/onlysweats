import { createFileRoute, Link } from "@tanstack/react-router";
import { Avatar } from "@/components/ui/avatar";
import { AgentChatsHandoff } from "@/components/agent-chats-handoff";
import { personById, venueById } from "@/lib/seed";
import { usePaceStore } from "@/lib/store";
import { When } from "@/components/when";
import { ME_ID } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/inbox/$id")({ component: Thread });

function Thread() {
  const { id } = Route.useParams();
  const booking = usePaceStore((s) => s.bookings.find((b) => b.id === id));
  const sessions = usePaceStore((s) => s.sessions);
  const session = sessions.find((x) => x.id === booking?.sessionId);
  const allMessages = usePaceStore((s) => s.messages);
  const messages = allMessages.filter((m) => m.bookingId === id);
  if (
    !booking ||
    !session ||
    (booking.participantId !== ME_ID && session.hostId !== ME_ID) ||
    messages.length === 0
  ) {
    return (
      <div className="mx-auto max-w-xl">
        <p className="text-muted">No legacy demo messages here.</p>
        <AgentChatsHandoff />
      </div>
    );
  }

  const otherId = booking.participantId === ME_ID ? session.hostId : booking.participantId;
  const other = personById(otherId);
  const venue = venueById(session.venueId);

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-xl flex-col">
      <Link to="/inbox" className="mb-4 inline-flex min-h-11 items-center text-sm text-muted">
        Back to Chats
      </Link>
      <div className="flex items-center gap-3">
        {other && <Avatar initials={other.initials} accent={other.accent} size="sm" />}
        <div>
          <p className="font-medium tracking-tight">{other?.name ?? "Former member"}</p>
          <p className="text-xs text-muted">
            {session.title} · <When iso={session.startAt} />
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs text-faint">
        Legacy demo messages · Read only. These simulated messages were written as member
        conversations in the earlier demo; they are not agent activity.
      </p>
      {venue && <p className="mt-1 text-xs text-faint">{venue.name}</p>}

      <div className="mt-5 flex flex-1 flex-col gap-2">
        {messages.map((m) => {
          const mine = m.fromId === ME_ID;
          const author = personById(m.fromId);
          return (
            <div
              key={m.id}
              className={cn(
                "max-w-[80%] rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed",
                mine ? "ml-auto bg-accent text-accent-fg" : "glass",
              )}
            >
              <p className="mb-1 text-[11px] opacity-70">
                {mine ? "You · demo member" : `${author?.name ?? "Former member"} · demo member`}
              </p>
              {m.text}
            </div>
          );
        })}
      </div>

      <AgentChatsHandoff />
      {(booking.status === "confirmed" || booking.status === "completed") && (
        <Link
          to="/sessions/$id"
          params={{ id: session.id }}
          className="mt-3 text-center text-sm text-muted"
        >
          Listing and pin
        </Link>
      )}
    </div>
  );
}
