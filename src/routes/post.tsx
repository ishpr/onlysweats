import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { venues } from "@/lib/seed";
import { usePaceStore } from "@/lib/store";
import { atDallas, nextWeekday } from "@/lib/time";
import type { Activity, JoinMode, Visibility } from "@/lib/types";
import { ACTIVITIES, ME_ID } from "@/lib/types";
import { cn } from "@/lib/utils";

type Search = {
  unlisted?: string;
  activity?: string;
  venue?: string;
  price?: string;
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
  const start = useMemo(() => initialStart(search), [search]);

  const [activity, setActivity] = useState<Activity>(
    isActivity(search.activity) ? search.activity : "run",
  );
  const [venueId, setVenueId] = useState(search.venue ?? "katy");
  const [title, setTitle] = useState(
    search.unlisted ? "Unlisted — invite from Messages" : "Easy miles I’m doing anyway",
  );
  const [detail, setDetail] = useState(
    "I’m going either way. Hold a seat if you’ll be at the pin.",
  );
  const [capacity, setCapacity] = useState(Number(search.capacity ?? 2));
  const [price, setPrice] = useState(Number(search.price ?? 1500));
  const [visibility, setVisibility] = useState<Visibility>(
    search.unlisted ? "unlisted" : "public",
  );
  const [womenOnly, setWomenOnly] = useState(false);
  const [joinMode, setJoinMode] = useState<JoinMode>(
    capacity >= 3 && price === 0 ? "instant" : "approve",
  );
  const [nl, setNl] = useState("");

  const venue = venues.find((v) => v.id === venueId)!;
  const gymWarn = price > 0 && venue.type === "gym_lobby";

  function publish() {
    if (price > 0 && (price < 500 || price > 4000)) {
      toast.error("Paid seats are $5–$40 in v1.");
      return;
    }
    const id = postSession({
      hostId: ME_ID,
      venueId,
      activity,
      title,
      detail,
      startAt: start.toISOString(),
      durationMin: activity === "hike" ? 120 : 40,
      capacity,
      priceCents: price,
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
        <p className="text-sm text-muted">Host</p>
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
            setPrice,
            setCapacity,
            setTitle,
          });
        }}
      >
        <input
          value={nl}
          onChange={(e) => setNl(e.target.value)}
          placeholder="Describe it — Tuesday 6am Katy Trail, $15"
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
          <span className="text-xs text-muted">Seats including you</span>
          <select
            value={capacity}
            onChange={(e) => {
              const c = Number(e.target.value);
              setCapacity(c);
              if (c >= 3 && venue.type !== "gym_lobby") setJoinMode("instant");
              if (c === 2 && price > 0) setJoinMode("approve");
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
        <label>
          <span className="text-xs text-muted">Price per seat</span>
          <select
            value={price}
            onChange={(e) => {
              const p = Number(e.target.value);
              setPrice(p);
              if (p > 0 && capacity === 2) setJoinMode("approve");
            }}
            className="mt-1 h-12 w-full rounded-2xl bg-fg/6 px-3 text-[15px] outline-none"
          >
            <option value={0}>$0</option>
            {[5, 8, 12, 15, 18, 20, 25, 30, 40].map((n) => (
              <option key={n} value={n * 100}>
                ${n}
              </option>
            ))}
          </select>
        </label>
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

      {gymWarn && (
        <p className="rounded-2xl bg-fg/6 px-4 py-3 text-sm text-muted">
          Gym membership is not the right to sell seats. Posting attests the
          venue allows this.
        </p>
      )}

      <p className="text-sm text-muted">
        Starts {start.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}.
        First paid post recommends a fee. Standing pairs may be $0.
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

function initialStart(search: Search) {
  const now = new Date();
  const hour = search.hour ? Number(search.hour) : 6;
  const minute = search.minute ? Number(search.minute) : 0;
  if (search.dow) return nextWeekday(now, Number(search.dow), hour, minute);
  return atDallas(now, 1, hour, minute);
}

function applyNl(
  text: string,
  set: {
    setActivity: (a: Activity) => void;
    setVenueId: (id: string) => void;
    setPrice: (n: number) => void;
    setCapacity: (n: number) => void;
    setTitle: (t: string) => void;
  },
) {
  const t = text.toLowerCase();
  if (/hike/.test(t)) set.setActivity("hike");
  else if (/walk/.test(t)) set.setActivity("walk");
  else if (/run|5k/.test(t)) set.setActivity("run");
  if (/katy/.test(t)) set.setVenueId("katy");
  if (/white|lake/.test(t)) set.setVenueId("whiterock");
  if (/trinity/.test(t)) set.setVenueId("trinity");
  if (/turtle/.test(t)) set.setVenueId("turtle");
  const m = t.match(/\$(\d+)/);
  if (m) set.setPrice(Number(m[1]) * 100);
  if (/free/.test(t)) set.setPrice(0);
  if (/two seats|2 seats/.test(t)) set.setCapacity(3);
  if (text.trim()) set.setTitle(text.trim());
}
