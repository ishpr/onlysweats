import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Clock,
  MapPin,
  Shield,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { ClusterMap } from "@/components/venue-map";
import { cancelPolicyLine, formatUsd } from "@/lib/money";
import { personById, venueById } from "@/lib/seed";
import { seatsLeft, usePaceStore } from "@/lib/store";
import {
  formatDayLong,
  formatDuration,
  formatTime,
  isInCheckinWindow,
} from "@/lib/time";
import { ACTIVITIES, ME_ID } from "@/lib/types";

export const Route = createFileRoute("/sessions/$id")({
  component: SessionDetail,
});

function SessionDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const session = usePaceStore((s) => s.sessions.find((x) => x.id === id));
  const bookings = usePaceStore((s) => s.bookings);
  const bookSeat = usePaceStore((s) => s.bookSeat);
  const approveBooking = usePaceStore((s) => s.approveBooking);
  const [pay, setPay] = useState(false);

  if (!session) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <p className="text-lg font-semibold">Listing not found</p>
        <Link to="/sessions" className="mt-3 inline-block text-sm text-muted">
          Back to sessions
        </Link>
      </div>
    );
  }

  const host = personById(session.hostId)!;
  const venue = venueById(session.venueId);
  const mine = bookings.find(
    (b) =>
      b.sessionId === session.id &&
      b.participantId === ME_ID &&
      b.status !== "cancelled" &&
      b.status !== "declined",
  );
  const pendingForHost = bookings.filter(
    (b) => b.sessionId === session.id && b.status === "pending" && session.hostId === ME_ID,
  );
  const left = seatsLeft(session, bookings);
  const booked = Boolean(mine && (mine.status === "confirmed" || mine.status === "completed"));
  const live = isInCheckinWindow(session.startAt) && (booked || session.hostId === ME_ID);
  const listing = session;

  function hold() {
    const res = bookSeat(listing.id);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setPay(false);
    toast.success(
      listing.joinMode === "instant" ? "Seat held. Pin unlocked." : "Request sent. Pin after approve.",
    );
    if (listing.joinMode === "instant") {
      void navigate({ to: "/inbox/$id", params: { id: res.bookingId } });
    }
  }

  return (
    <div className="mx-auto max-w-xl pb-8">
      <div className="relative overflow-hidden rounded-[32px]">
        <img
          src={venue?.image}
          alt={venue?.name ?? ""}
          className="aspect-16/10 w-full object-cover"
        />
        <div className="absolute inset-0 bg-linear-to-t from-bg via-transparent to-transparent" />
      </div>

      <div className="mt-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
          {ACTIVITIES[session.activity].label} · {formatDayLong(session.startAt)}
        </p>
        <h1 className="mt-1 text-balance text-[30px] font-semibold leading-[1.12] tracking-tight">
          {session.title}
        </h1>
        <p className="mt-3 text-pretty text-[15px] leading-relaxed text-muted">
          {session.detail}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Meta
          icon={Clock}
          label={formatTime(session.startAt)}
          value={formatDuration(session.durationMin)}
        />
        <Meta
          icon={Users}
          label={`${left} open`}
          value={`${session.capacity} cap`}
        />
        <Meta
          icon={MapPin}
          label={venue?.neighborhood ?? ""}
          value={venue?.type.replace("_", " ") ?? ""}
        />
        <Meta
          icon={Shield}
          label={session.joinMode === "instant" ? "Instant join" : "Host approves"}
          value={session.womenOnly ? "Women-only" : "Open listing"}
        />
      </div>

      <div className="mt-5 flex items-center gap-3 glass rounded-[24px] p-3">
        <Avatar initials={host.initials} accent={host.accent} />
        <div className="min-w-0 flex-1">
          <p className="font-medium tracking-tight">
            {host.name}
            {host.isLead && (
              <span className="ml-2 text-[11px] font-medium uppercase tracking-wider text-muted">
                Lead
              </span>
            )}
          </p>
          <p className="truncate text-sm text-muted">
            {host.completedCount} completed · {host.onTimePct}% on time · {host.neighborhood}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <ClusterMap
          sessions={[session]}
          activeId={session.id}
          approximate={!booked}
        />
        <p className="mt-2 text-sm text-muted">
          {booked
            ? venue?.hint
            : "Approximate pin until the seat is held. Exact trailhead after booking."}
        </p>
      </div>

      {session.priceCents > 0 && venue?.type === "gym_lobby" && (
        <p className="mt-4 rounded-2xl bg-fg/6 px-4 py-3 text-sm text-muted">
          Gym membership is not permission to sell seats. Host attests this lobby
          allows a paid meetup.
        </p>
      )}

      <p className="mt-5 text-sm leading-relaxed text-muted">
        {cancelPolicyLine(session.priceCents)}
      </p>

      {pendingForHost.map((b) => (
        <div key={b.id} className="mt-4 flex items-center justify-between glass rounded-2xl p-3">
          <p className="text-sm">Seat request waiting</p>
          <Button variant="accent" onClick={() => approveBooking(b.id)}>
            Approve
          </Button>
        </div>
      ))}

      <div className="sticky bottom-24 mt-6 md:bottom-6">
        {live ? (
          <Link
            to="/live/$id"
            params={{ id: session.id }}
            className="press flex min-h-11 w-full items-center justify-center rounded-full bg-accent text-[15px] font-medium text-accent-fg"
          >
            Open live session
          </Link>
        ) : mine ? (
          <Link
            to="/inbox/$id"
            params={{ id: mine.id }}
            className="press glass flex min-h-11 w-full items-center justify-center rounded-full text-[15px] font-medium"
          >
            {mine.status === "pending" ? "Request pending" : "Open thread"}
          </Link>
        ) : session.hostId === ME_ID ? (
          <Button className="w-full" variant="glass" disabled>
            You’re hosting
          </Button>
        ) : left <= 0 ? (
          <Button className="w-full" disabled>
            Full
          </Button>
        ) : (
          <Button className="w-full" onClick={() => setPay(true)}>
            {session.priceCents === 0
              ? "Hold the seat"
              : `Hold ${formatUsd(session.priceCents)}`}
          </Button>
        )}
      </div>

      {pay && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-bg/70 p-4 backdrop-blur-md">
          <div className="glass-strong w-full max-w-md rounded-[32px] p-5">
            <h2 className="text-xl font-semibold tracking-tight">Hold the slot</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {cancelPolicyLine(session.priceCents)} Price on the listing is the
              price — no extra fee.
            </p>
            <div className="mt-5 flex items-center justify-between rounded-2xl bg-fg/6 px-4 py-3">
              <span className="text-sm text-muted">Authorization</span>
              <span className="text-lg font-semibold tabular-nums">
                {formatUsd(session.priceCents)}
              </span>
            </div>
            <Button className="mt-5 w-full" onClick={hold}>
              {session.priceCents === 0 ? "Confirm seat" : "Pay with Apple Pay"}
            </Button>
            <Button variant="ghost" className="mt-2 w-full" onClick={() => setPay(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Meta({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="glass rounded-2xl p-3">
      <Icon className="size-4 text-muted" />
      <p className="mt-2 text-[15px] font-medium tracking-tight">{label}</p>
      <p className="text-xs capitalize text-muted">{value}</p>
    </div>
  );
}
