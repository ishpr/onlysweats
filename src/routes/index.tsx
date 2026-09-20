import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { ActivityRings, RingLegend } from "@/components/activity-rings";
import { SessionCard } from "@/components/session-card";
import { people } from "@/lib/seed";
import { usePaceStore } from "@/lib/store";
import { Greeting } from "@/components/when";
import { formatSleep } from "@/lib/time";
import { ME_ID } from "@/lib/types";

export const Route = createFileRoute("/")({ component: Today });

function Today() {
  const sessions = usePaceStore((s) => s.sessions);
  const bookings = usePaceStore((s) => s.bookings);
  const health = usePaceStore((s) => s.health);
  const me = people.find((p) => p.id === ME_ID)!;
  const now = Date.now();
  const horizon = now + 48 * 60 * 60 * 1000;
  const upcoming = sessions
    .filter(
      (s) =>
        s.visibility === "public" &&
        new Date(s.startAt).getTime() < horizon &&
        (s.status === "open" || s.status === "live" || s.status === "full"),
    )
    .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));

  const suggestion = sessions.find((s) => s.id === "seed-live") ?? upcoming[0];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <p className="text-sm text-muted">
          <Greeting />
        </p>
        <h1 className="text-balance text-[34px] font-semibold leading-[1.1] tracking-tight">
          {me.name}
        </h1>
      </header>

      {health.connected && suggestion && (
        <Link
          to="/sessions/$id"
          params={{ id: suggestion.id }}
          className="glass rounded-[28px] p-4"
        >
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-stand">
            Intelligence · Health
          </p>
          <p className="mt-2 text-pretty text-[15px] leading-relaxed text-fg">
            Sleep {formatSleep(health.sleepMin)}, HRV {health.hrvMs} ms, recovery{" "}
            {health.recoveryPct}%. {suggestion.title} fits an easy day — not a
            workout plan.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm text-muted">
            Hold the slot <ChevronRight className="size-4" />
          </span>
        </Link>
      )}

      <Link
        to="/health"
        className="glass flex items-center gap-5 rounded-[28px] p-4"
      >
        <ActivityRings
          size={118}
          move={health.moveKcal / health.moveGoal}
          exercise={health.exerciseMin / health.exerciseGoal}
          stand={health.standHours / health.standGoal}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Fitness</h2>
            <span className="text-xs text-muted">Apple Health</span>
          </div>
          <div className="mt-3">
            <RingLegend
              move={health.moveKcal / health.moveGoal}
              exercise={health.exerciseMin / health.exerciseGoal}
              stand={health.standHours / health.standGoal}
              moveKcal={health.moveKcal}
              moveGoal={health.moveGoal}
              exerciseMin={health.exerciseMin}
              exerciseGoal={health.exerciseGoal}
              standHours={health.standHours}
              standGoal={health.standGoal}
            />
          </div>
        </div>
      </Link>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Next 48 hours</h2>
          <Link to="/sessions" className="text-sm text-muted">
            All listings
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <div className="glass rounded-[28px] p-6">
            <h3 className="text-xl font-semibold tracking-tight">
              Invite someone you already know
            </h3>
            <p className="mt-2 text-pretty text-sm leading-relaxed text-muted">
              Empty cluster still works. Create an unlisted session and share it
              from Messages.
            </p>
            <Link
              to="/post"
              className="press mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-fg px-5 text-[15px] font-medium text-bg"
            >
              Open two seats
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {upcoming.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                bookings={bookings}
                featured={s.status === "live"}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
