import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { venues } from "@/lib/seed";
import { usePaceStore } from "@/lib/store";
import { addDallasDays, atDallas, formatDay, formatWhen, nextWeekday, zonedParts } from "@/lib/time";
import type { Activity, JoinMode, Visibility } from "@/lib/types";
import { ACTIVITIES, ME_ID } from "@/lib/types";
import { cn } from "@/lib/utils";

type Search = {
  unlisted?: string;
  activity?: string;
  venue?: string;
  capacity?: string;
  dow?: string;
  hour?: string;
  minute?: string;
};

export const Route = createFileRoute("/post")({
  component: Post,
});

function Post() {
  const search = useSearch({ strict: false }) as Search;
  const navigate = useNavigate();
  const postSession = usePaceStore((s) => s.postSession);
  // Computed once: the picker owns the start time after first render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = useMemo(() => initialSlot(search), []);
  const [days, setDays] = useState(initial.days);
  const [time, setTime] = useState(initial.time);
  const start = useMemo(() => {
    const [h, m] = time.split(":").map(Number);
    return atDallas(new Date(), days, h || 0, m || 0);
  }, [days, time]);
  const dayOptions = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 8 }, (_, i) => ({
      value: i,
      label:
        i === 0
          ? "Today"
          : i === 1
            ? "Tomorrow"
            : formatDay(atDallas(now, i, 12, 0).toISOString()),
    }));
  }, []);

  const [activity, setActivity] = useState<Activity>(
    isActivity(search.activity) ? search.activity : "run",
  );
  const [venueId, setVenueId] = useState(search.venue ?? "katy");
  const [title, setTitle] = useState(
    search.unlisted ? "Unlisted — invite from Messages" : "Easy session I’m doing anyway",
  );
  const [detail, setDetail] = useState(
    "I’m going either way. Join if you’ll be at the pin.",
  );
  const [capacity, setCapacity] = useState(Number(search.capacity ?? 2));
  const [visibility, setVisibility] = useState<Visibility>(
    search.unlisted ? "unlisted" : "public",
  );
  const [womenOnly, setWomenOnly] = useState(false);
  const [joinMode, setJoinMode] = useState<JoinMode>(
    capacity >= 3 ? "instant" : "approve",
  );
  const [nl, setNl] = useState("");

  const venue = venues.find((v) => v.id === venueId)!;
  const isGym = venue.type === "gym_lobby";

  function publish() {
    if (!title.trim()) {
      toast.error("Give it a title.");
      return;
    }
    if (start.getTime() < Date.now() + 30 * 60_000) {
      toast.error("Pick a start at least 30 minutes out.");
      return;
    }
    const id = postSession({
      hostId: ME_ID,
      venueId,
      activity,
      title: title.trim(),
      detail: detail.trim(),
      startAt: start.toISOString(),
      durationMin: activity === "hike" ? 120 : 40,
      capacity,
      priceCents: 0,
      visibility,
      joinMode,
      womenOnly,
      hostAttestsPaidOk: true,
    });
    toast.success("Listing is up. You’re going anyway.");
    void navigate({ to: "/sessions/$id", params: { id } });
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <header>
        <p className="text-sm text-muted">Post a session</p>
        <h1 className="text-[32px] font-semibold tracking-tight">
          You’re going anyway. Open two seats.
        </h1>
      </header>

      <form
        className="glass flex items-center gap-2 rounded-full p-1.5 pl-4"
        onSubmit={(e) => {
          e.preventDefault();
          applyNl(nl, {
            setActivity,
            setVenueId,
            setCapacity,
            setTitle,
          });
        }}
      >
        <input
          value={nl}
          onChange={(e) => setNl(e.target.value)}
          placeholder="Describe it — Tuesday 6am Katy Trail, two seats"
          className="h-11 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
        />
        <button
          type="submit"
          className="rounded-full bg-fg px-4 py-2 text-sm font-medium text-bg"
        >
          Fill
        </button>
      </form>

      <div className="flex gap-2 overflow-x-auto">
        {(Object.keys(ACTIVITIES) as Activity[]).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setActivity(a)}
            className={cn(
              "h-10 shrink-0 rounded-full px-4 text-sm font-medium",
              activity === a ? "bg-fg text-bg" : "glass text-muted",
            )}
          >
            {ACTIVITIES[a].label}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="text-xs text-muted">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 h-12 w-full rounded-2xl bg-fg/6 px-4 text-[15px] outline-none ring-stand/0 focus:ring-2 focus:ring-stand/40"
        />
      </label>
      <label className="block">
        <span className="text-xs text-muted">Detail</span>
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-2xl bg-fg/6 px-4 py-3 text-[15px] outline-none focus:ring-2 focus:ring-stand/40"
        />
      </label>

      <div>
        <p className="text-xs text-muted">Place</p>
        <div className="mt-2 grid gap-2">
          {venues.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVenueId(v.id)}
              className={cn(
                "rounded-2xl px-4 py-3 text-left",
                venueId === v.id ? "bg-fg text-bg" : "glass",
              )}
            >
              <p className="font-medium">{v.name}</p>
              <p className={cn("text-xs", venueId === v.id ? "text-bg/70" : "text-muted")}>
                {v.neighborhood} · {v.type.replace("_", " ")}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="text-xs text-muted">Day</span>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="mt-1 h-12 w-full rounded-2xl bg-fg/6 px-3 text-[15px] outline-none focus:ring-2 focus:ring-stand/40"
          >
            {dayOptions.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-xs text-muted">Start (Dallas time)</span>
          <input
            type="time"
            step={300}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="mt-1 h-12 w-full rounded-2xl bg-fg/6 px-3 text-[15px] outline-none focus:ring-2 focus:ring-stand/40"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="text-xs text-muted">Seats including you</span>
          <select
            value={capacity}
            onChange={(e) => {
              const c = Number(e.target.value);
              setCapacity(c);
              if (c >= 3 && !isGym) setJoinMode("instant");
              if (c === 2) setJoinMode("approve");
            }}
            className="mt-1 h-12 w-full rounded-2xl bg-fg/6 px-3 text-[15px] outline-none"
          >
            {[2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="text-xs text-muted">Cost to join</span>
          <p className="mt-1 flex h-12 items-center rounded-2xl bg-fg/6 px-3 text-[15px] text-muted">
            Free — nobody pays anybody
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Chip on={visibility === "public"} onClick={() => setVisibility("public")}>
          Public
        </Chip>
        <Chip on={visibility === "unlisted"} onClick={() => setVisibility("unlisted")}>
          Unlisted invite
        </Chip>
        <Chip on={joinMode === "approve"} onClick={() => setJoinMode("approve")}>
          Approve
        </Chip>
        <Chip on={joinMode === "instant"} onClick={() => setJoinMode("instant")}>
          Instant
        </Chip>
        <Chip on={womenOnly} onClick={() => setWomenOnly(!womenOnly)}>
          Women-only
        </Chip>
      </div>

      {isGym && (
        <p className="rounded-2xl bg-fg/6 px-4 py-3 text-sm text-muted">
          Gym session. Whoever joins needs their own access to this gym.
        </p>
      )}

      <p className="text-sm text-muted">
        Starts {formatWhen(start.toISOString())}.
        Skipping costs the other person their morning: a no-show is $10 and a strike.
      </p>

      <Button className="w-full" onClick={publish}>
        Post the listing
      </Button>
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 rounded-full px-3.5 text-[13px] font-medium",
        on ? "bg-fg text-bg" : "glass text-muted",
      )}
    >
      {children}
    </button>
  );
}

function isActivity(v?: string): v is Activity {
  return !!v && v in ACTIVITIES;
}

function initialSlot(search: Search) {
  const now = new Date();
  const hour = search.hour ? Number(search.hour) : 6;
  const minute = search.minute ? Number(search.minute) : 0;
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (!search.dow) return { days: 1, time };
  const target = zonedParts(nextWeekday(now, Number(search.dow), hour, minute));
  for (let i = 0; i < 8; i++) {
    const d = addDallasDays(now, i);
    if (d.month === target.month && d.day === target.day) return { days: i, time };
  }
  return { days: 1, time };
}

function applyNl(
  text: string,
  set: {
    setActivity: (a: Activity) => void;
    setVenueId: (id: string) => void;
    setCapacity: (n: number) => void;
    setTitle: (t: string) => void;
  },
) {
  const t = text.toLowerCase();
  if (/hike/.test(t)) set.setActivity("hike");
  else if (/walk/.test(t)) set.setActivity("walk");
  else if (/ride|cycl|bike/.test(t)) set.setActivity("ride");
  else if (/lift|strength|gym/.test(t)) set.setActivity("strength");
  else if (/run|5k/.test(t)) set.setActivity("run");
  if (/katy/.test(t)) set.setVenueId("katy");
  if (/white|lake/.test(t)) set.setVenueId("whiterock");
  if (/trinity/.test(t)) set.setVenueId("trinity");
  if (/turtle/.test(t)) set.setVenueId("turtle");
  if (/two seats|2 seats/.test(t)) set.setCapacity(3);
  if (text.trim()) set.setTitle(text.trim());
}
