import { Link } from "@tanstack/react-router";
import { Clock, MapPin, Users } from "lucide-react";
import { formatUsd } from "@/lib/money";
import { personById, venueById } from "@/lib/seed";
import { seatsLeft } from "@/lib/store";
import { When } from "@/components/when";
import { formatDuration } from "@/lib/time";
import type { Booking, Session } from "@/lib/types";
import { ACTIVITIES } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar } from "./ui/avatar";

export function SessionCard({
  session,
  bookings,
  featured = false,
}: {
  session: Session;
  bookings: Booking[];
  featured?: boolean;
}) {
  const host = personById(session.hostId);
  const venue = venueById(session.venueId);
  const left = seatsLeft(session, bookings);
  const live = session.status === "live";

  return (
    <Link
      to="/sessions/$id"
      params={{ id: session.id }}
      className={cn(
        "press group relative block overflow-hidden rounded-[28px] text-left",
        featured ? "min-h-56" : "min-h-44",
      )}
    >
      <img
        src={venue?.image}
        alt=""
        className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03]"
      />
      <div className="absolute inset-0 bg-linear-to-t from-bg via-bg/55 to-bg/10" />
      <div className="relative flex h-full min-h-44 flex-col justify-between p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            <Chip>{ACTIVITIES[session.activity].label}</Chip>
            {live && <Chip tone="move">Live</Chip>}
            {session.womenOnly && <Chip>Women-only</Chip>}
            {session.priceCents === 0 && <Chip>Free seat</Chip>}
            {session.visibility === "unlisted" && <Chip>Unlisted</Chip>}
          </div>
          {host && <Avatar initials={host.initials} accent={host.accent} size="sm" />}
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg/70">
            <When iso={session.startAt} />
          </p>
          <h3 className="mt-1 text-balance text-xl font-semibold tracking-tight text-fg">
            {session.title}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg/80">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" />
              {venue?.name}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" />
              {formatDuration(session.durationMin)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" />
              {left} {left === 1 ? "seat" : "seats"}
            </span>
            <span className="font-medium tabular-nums text-fg">
              {session.priceCents === 0 ? "Free" : formatUsd(session.priceCents)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function Chip({
  children,
  tone = "glass",
}: {
  children: React.ReactNode;
  tone?: "glass" | "move";
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide",
        tone === "move" ? "bg-move text-fg" : "glass text-fg",
      )}
    >
      {children}
    </span>
  );
}
