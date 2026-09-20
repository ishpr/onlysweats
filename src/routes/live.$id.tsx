import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CheckinMap } from "@/components/checkin-map";
import { RatingSheet } from "@/components/rating-sheet";
import { Button } from "@/components/ui/button";
import { PaceMark } from "@/components/icons";
import { personById, venueById } from "@/lib/seed";
import { usePaceStore } from "@/lib/store";
import { checkinBounds, formatTime, isInCheckinWindow } from "@/lib/time";
import { GEOFENCE_M, ME_ID } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/live/$id")({ component: Live });

function Live() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const session = usePaceStore((s) => s.sessions.find((x) => x.id === id));
  const bookings = usePaceStore((s) => s.bookings);
  const distanceM = usePaceStore((s) => s.distanceM);
  const setDistance = usePaceStore((s) => s.setDistance);
  const checkIn = usePaceStore((s) => s.checkIn);
  const revealCode = usePaceStore((s) => s.revealCode);
  const submitCode = usePaceStore((s) => s.submitCode);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [showRating, setShowRating] = useState(false);

  const booking = bookings.find(
    (b) =>
      b.sessionId === id &&
      (b.participantId === ME_ID || session?.hostId === ME_ID) &&
      (b.status === "confirmed" || b.status === "completed"),
  );

  if (!session || !booking) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-semibold">No live seat</p>
        <Link to="/prototype" className="text-sm text-muted">
          Back to Today
        </Link>
      </div>
    );
  }

  const host = personById(session.hostId)!;
  const venue = venueById(session.venueId);
  const otherId = booking.participantId === ME_ID ? session.hostId : booking.participantId;
  const otherName = personById(otherId)?.name.split(" ")[0] ?? "Them";
  const inWindow = isInCheckinWindow(session.startAt);
  const inside = distanceM <= GEOFENCE_M;
  const meIn =
    session.hostId === ME_ID
      ? Boolean(booking.hostCheckedInAt)
      : Boolean(booking.participantCheckedInAt);
  const themIn =
    session.hostId === ME_ID
      ? Boolean(booking.participantCheckedInAt)
      : Boolean(booking.hostCheckedInAt);
  const done = booking.status === "completed";
  const { from, to } = checkinBounds(session.startAt);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-8 pt-[max(16px,env(safe-area-inset-top))]">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => void navigate({ to: "/prototype" })}
          className="text-sm text-muted"
        >
          Close
        </button>
        <PaceMark className="size-7" />
        <span className="text-sm tabular-nums text-muted">
          {formatTime(session.startAt)}
        </span>
      </div>

      <h1 className="mt-6 text-[28px] font-semibold tracking-tight">Live session</h1>
      <p className="text-sm text-muted">
        {venue?.name} · {host.name.split(" ")[0]}
      </p>
      <p className="mt-1 text-xs text-faint">
        Window {formatTime(new Date(from).toISOString())} –{" "}
        {formatTime(new Date(to).toISOString())}
      </p>

      <div className="mt-5">
        <CheckinMap distanceM={distanceM} onDistance={setDistance} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Status on={meIn} label="You" />
        <Status on={themIn} label={otherName} />
      </div>

      {!done && (
        <>
          <Button
            className="mt-5 w-full"
            variant={inside ? "accent" : "glass"}
            disabled={!inWindow || !inside || meIn}
            onClick={() => checkIn(booking.id, "geo")}
          >
            {!inWindow
              ? "Outside check-in window"
              : meIn
                ? "You’re in"
                : inside
                  ? "Check in · 150 m"
                  : "Walk inside 150 m"}
          </Button>
          <Button
            className="mt-2 w-full"
            variant="soft"
            onClick={() => setDistance(42)}
          >
            Simulate arriving at pin
          </Button>

          <div className="mt-6 glass rounded-[24px] p-4">
            <p className="text-sm font-medium">Session code</p>
            <p className="mt-1 text-xs text-muted">
              Trails drop GPS. Host reveals a 4-digit code, valid 10 minutes.
            </p>
            {session.codeRevealedAt ? (
              <p className="mt-3 text-center text-3xl font-semibold tabular-nums tracking-[0.4em]">
                {session.hostId === ME_ID || session.codeRevealedAt
                  ? session.code
                  : "••••"}
              </p>
            ) : (
              <Button
                variant="glass"
                className="mt-3 w-full"
                onClick={() => revealCode(session.id)}
              >
                Reveal code
              </Button>
            )}
            {session.codeRevealedAt && !meIn && (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const res = submitCode(booking.id, code);
                  if (!res.ok) setCodeError(res.error ?? "Try again");
                  else setCodeError("");
                }}
              >
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="0000"
                  className="h-12 flex-1 rounded-2xl bg-fg/8 px-4 text-center text-lg tabular-nums tracking-[0.3em] outline-none"
                />
                <Button type="submit" variant="primary">
                  Enter
                </Button>
              </form>
            )}
            {codeError && <p className="mt-2 text-xs text-danger">{codeError}</p>}
          </div>
        </>
      )}

      {done && (
        <div className="mt-6">
          <div className="rounded-[28px] bg-accent/15 p-5 text-center">
            <p className="text-lg font-semibold text-accent">Both checked in</p>
            <p className="mt-1 text-sm text-muted">
              Capture is eligible. Workout writes to Fitness after the hold.
            </p>
          </div>
          {!booking.ratedByParticipant && !showRating && (
            <Button className="mt-4 w-full" onClick={() => setShowRating(true)}>
              Rate this session
            </Button>
          )}
          {showRating && (
            <div className="mt-4">
              <RatingSheet
                bookingId={booking.id}
                toId={otherId}
                onDone={() => {
                  setShowRating(false);
                  void navigate({ to: "/health" });
                }}
              />
            </div>
          )}
        </div>
      )}

      {themIn && !meIn && (
        <p className="mt-3 text-center text-sm text-muted">Waiting on you at the pin.</p>
      )}
      {meIn && !themIn && (
        <p className="mt-3 text-center text-sm text-muted">Waiting for the other person…</p>
      )}
    </div>
  );
}

function Status({ on, label }: { on: boolean; label: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl px-3 py-3 text-center",
        on ? "bg-accent/15 text-accent" : "glass text-muted",
      )}
    >
      <p className="text-xs">{label}</p>
      <p className="mt-1 text-sm font-medium">{on ? "Checked in" : "Not yet"}</p>
    </div>
  );
}
