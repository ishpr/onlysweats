import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUp } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { personById, venueById } from "@/lib/seed";
import { usePaceStore } from "@/lib/store";
import { When } from "@/components/when";
import { chatExpiresAt } from "@/lib/time";
import { ME_ID } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/inbox/$id")({ component: Thread });

const SMART = [
  "On my way — eight minutes out.",
  "I’ll be at the meeting pin.",
  "Still on. See you there.",
];

function Thread() {
  const { id } = Route.useParams();
  const booking = usePaceStore((s) => s.bookings.find((b) => b.id === id));
  const sessions = usePaceStore((s) => s.sessions);
  const session = sessions.find((x) => x.id === booking?.sessionId);
  const allMessages = usePaceStore((s) => s.messages);
  const messages = allMessages.filter((m) => m.bookingId === id);
  const send = usePaceStore((s) => s.sendMessage);
  const [text, setText] = useState("");

  if (!booking || !session) {
    return <p className="text-muted">Thread closed.</p>;
  }

  const otherId =
    booking.participantId === ME_ID ? session.hostId : booking.participantId;
  const other = personById(otherId)!;
  const venue = venueById(session.venueId);
  const expires = chatExpiresAt(session.startAt, session.durationMin);
  const expired = Date.now() > expires.getTime() && booking.status === "completed";

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-xl flex-col">
      <div className="flex items-center gap-3">
        <Avatar initials={other.initials} accent={other.accent} size="sm" />
        <div>
          <p className="font-medium tracking-tight">{other.name}</p>
          <p className="text-xs text-muted">
            {session.title} · <When iso={session.startAt} />
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs text-faint">
        {venue?.name}. Chat expires <When iso={expires.toISOString()} />.
        Off-platform payment is a ban.
      </p>

      <div className="mt-5 flex flex-1 flex-col gap-2">
        {messages.map((m) => {
          const mine = m.fromId === ME_ID;
          return (
            <div
              key={m.id}
              className={cn("max-w-[80%] rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed", mine ? "ml-auto bg-accent text-accent-fg" : "glass")}
            >
              {m.text}
            </div>
          );
        })}
      </div>

      {expired ? (
        <p className="mt-4 text-sm text-muted">This thread expired.</p>
      ) : (
        <>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {SMART.map((s) => (
              <button
                key={s}
                type="button"
                className="glass shrink-0 rounded-full px-3 py-2 text-[12px] text-fg"
                onClick={() => send(booking.id, s)}
              >
                {s}
              </button>
            ))}
          </div>
          <form
            className="mt-3 flex items-center gap-2 rounded-full glass p-1.5 pl-4"
            onSubmit={(e) => {
              e.preventDefault();
              send(booking.id, text);
              setText("");
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Message"
              className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
            />
            <button
              type="submit"
              className="flex size-11 items-center justify-center rounded-full bg-fg text-bg"
              aria-label="Send"
            >
              <ArrowUp className="size-4" />
            </button>
          </form>
          {(booking.status === "confirmed" || booking.status === "completed") && (
            <Link
              to="/sessions/$id"
              params={{ id: session.id }}
              className="mt-3 text-center text-sm text-muted"
            >
              Listing and pin
            </Link>
          )}
        </>
      )}
    </div>
  );
}
