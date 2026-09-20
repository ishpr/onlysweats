import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { SessionCard } from "@/components/session-card";
import { ClusterMap } from "@/components/venue-map";
import { usePaceStore } from "@/lib/store";
import type { Activity } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/sessions/")({
  component: Sessions,
});

const FILTERS = [
  { id: "all", label: "All" },
  { id: "run", label: "Run" },
  { id: "hike", label: "Hike" },
  { id: "free", label: "$0" },
  { id: "women", label: "Women-only" },
  { id: "morning", label: "Morning" },
] as const;

function Sessions() {
  const raw = useSearch({ strict: false }) as { filter?: string };
  const [filter, setFilter] = useState(raw.filter ?? "all");
  const sessions = usePaceStore((s) => s.sessions);
  const bookings = usePaceStore((s) => s.bookings);
  const prefs = usePaceStore((s) => s.prefs);
  const navigate = useNavigate();

  const list = useMemo(() => {
    return sessions
      .filter((s) => s.visibility === "public")
      .filter((s) => s.status !== "cancelled" && s.status !== "completed")
      .filter((s) => (prefs.womenOnlySearch ? s.womenOnly : true))
      .filter((s) => {
        if (filter === "run" || filter === "hike") return s.activity === (filter as Activity);
        if (filter === "free") return s.priceCents === 0;
        if (filter === "women") return s.womenOnly;
        if (filter === "morning") {
          const h = new Date(s.startAt).getHours();
          return h >= 5 && h < 10;
        }
        return true;
      })
      .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  }, [sessions, filter, prefs.womenOnlySearch]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header>
        <p className="text-sm text-muted">Oak Lawn · next 7 days</p>
        <h1 className="text-[32px] font-semibold tracking-tight">Sessions</h1>
        <p className="mt-1 max-w-md text-pretty text-sm text-muted">
          Upcoming time and place — not a grid of faces.
        </p>
      </header>

      <ClusterMap
        sessions={list}
        onSelect={(id) =>
          void navigate({ to: "/sessions/$id", params: { id } })
        }
      />

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "h-9 shrink-0 rounded-full px-3.5 text-[13px] font-medium",
              filter === f.id ? "bg-fg text-bg" : "glass text-muted",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {list.map((s) => (
          <SessionCard key={s.id} session={s} bookings={bookings} />
        ))}
        {list.length === 0 && (
          <p className="glass rounded-[24px] p-6 text-sm text-muted">
            Nothing in that window. Post the run you’re doing anyway.
          </p>
        )}
      </div>
    </div>
  );
}
