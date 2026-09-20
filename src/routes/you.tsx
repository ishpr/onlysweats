import { createFileRoute, Link } from "@tanstack/react-router";
import { ActivityRings } from "@/components/activity-rings";
import { Avatar } from "@/components/ui/avatar";
import { formatUsd } from "@/lib/money";
import { people } from "@/lib/seed";
import { usePaceStore } from "@/lib/store";
import { ME_ID } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/you")({ component: You });

function You() {
  const me = people.find((p) => p.id === ME_ID)!;
  const health = usePaceStore((s) => s.health);
  const prefs = usePaceStore((s) => s.prefs);
  const setPref = usePaceStore((s) => s.setPref);
  const credit = usePaceStore((s) => s.creditCents);
  const bookings = usePaceStore((s) => s.bookings);
  const completed = bookings.filter((b) => b.status === "completed").length;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <header className="flex items-center gap-4">
        <Avatar initials={me.initials} accent={me.accent} size="lg" />
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">{me.name}</h1>
          <p className="text-sm text-muted">
            {me.neighborhood} · Member since {me.memberSince}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Completed" value={String(me.completedCount + completed)} />
        <Stat label="On time" value={`${me.onTimePct}%`} />
        <Stat label="Join again" value={`${me.wouldJoinPct}%`} />
      </div>

      <Link to="/health" className="glass flex items-center gap-4 rounded-[28px] p-4">
        <ActivityRings
          size={88}
          move={health.moveKcal / health.moveGoal}
          exercise={health.exerciseMin / health.exerciseGoal}
          stand={health.standHours / health.standGoal}
        />
        <div>
          <p className="font-medium">Apple Fitness</p>
          <p className="text-sm text-muted">
            {health.connected ? "Rings, HRV, sleep — used for seat fit, not coaching." : "Connect Health"}
          </p>
        </div>
      </Link>

      <section className="glass rounded-[28px] p-4">
        <h2 className="text-sm font-medium text-muted">Safety</h2>
        <Toggle
          label="Women-only search"
          on={prefs.womenOnlySearch}
          onChange={(on) => setPref({ womenOnlySearch: on })}
        />
        <Toggle
          label="Share Health with Intelligence"
          on={prefs.shareHealth}
          onChange={(on) => setPref({ shareHealth: on })}
        />
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Report and block live on every listing. 18+. Everyone verifies a phone
          and a selfie before joining a public session. Ranking never uses body
          or photo quality.
        </p>
      </section>

      <section className="glass rounded-[28px] p-4">
        <h2 className="text-sm font-medium text-muted">Credit</h2>
        <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
          {formatUsd(credit)}
        </p>
        <p className="text-sm text-muted">
          You get $5 of membership credit when you show up and the other person
          doesn’t. Nobody pays anybody for a session.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-2xl p-3">
      <p className="text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-fg/6 py-2 text-left text-[15px] last:border-0"
    >
      {label}
      <span
        className={cn(
          "relative h-7 w-11 rounded-full transition-colors",
          on ? "bg-accent" : "bg-fg/15",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-6 rounded-full bg-fg transition-transform",
            on ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
