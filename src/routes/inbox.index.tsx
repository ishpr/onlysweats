import { createFileRoute, Link } from "@tanstack/react-router";
import { Avatar } from "@/components/ui/avatar";
import { personById, venueById } from "@/lib/seed";
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
        b.participantId === ME_ID ||
        sessions.find((s) => s.id === b.sessionId)?.hostId === ME_ID,
    )
    .filter((b) => b.status !== "declined")
    .map((b) => {
      const session = sessions.find((s) => s.id === b.sessionId);
      const otherId =
        b.participantId === ME_ID ? session?.hostId : b.participantId;
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
      <h1 className="text-[32px] font-semibold tracking-tight">Inbox</h1>
      <p className="mt-1 text-sm text-muted">
        Booking-scoped. Expires 24 hours after the session.
      </p>
      <div className="mt-5 flex flex-col gap-1">
        {threads.map(({ booking, session, otherId, last }) => {
          const other = otherId ? personById(otherId) : undefined;
          const venue = session ? venueById(session.venueId) : undefined;
          return (
            <Link
              key={booking.id}
              to="/inbox/$id"
              params={{ id: booking.id }}
              className="flex items-center gap-3 rounded-2xl px-2 py-3 hover:bg-fg/6"
            >
              {other && (
                <Avatar initials={other.initials} accent={other.accent} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-medium tracking-tight">{other?.name}</p>
                  {session && (
                    <span className="text-[11px] text-faint">
                      <When iso={session.startAt} />
                    </span>
                  )}
                </div>
                <p className="truncate text-sm text-muted">
                  {last?.text ?? venue?.name}
                </p>
              </div>
            </Link>
          );
        })}
        {threads.length === 0 && (
          <p className="glass mt-4 rounded-2xl p-6 text-sm text-muted">
            A thread opens when you join a session.
          </p>
        )}
      </div>
    </div>
  );
}
