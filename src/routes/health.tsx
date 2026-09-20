import { createFileRoute, Link } from "@tanstack/react-router";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { ActivityRings, RingLegend } from "@/components/activity-rings";
import { Button } from "@/components/ui/button";
import { usePaceStore } from "@/lib/store";
import { When } from "@/components/when";
import { formatSleep } from "@/lib/time";
import { ACTIVITIES } from "@/lib/types";

export const Route = createFileRoute("/health")({ component: Health });

function Health() {
  const health = usePaceStore((s) => s.health);
  const connect = usePaceStore((s) => s.connectHealth);
  const data = health.moveWeek.map((kcal, i) => ({
    d: ["M", "T", "W", "T", "F", "S", "S"][i],
    kcal,
  }));

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <header>
        <p className="text-sm text-muted">Apple Fitness + Health</p>
        <h1 className="text-[32px] font-semibold tracking-tight">Activity</h1>
      </header>

      {!health.connected ? (
        <div className="glass rounded-[28px] p-6">
          <h2 className="text-xl font-semibold">Connect Apple Health</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Rings, sleep, and HRV help Intelligence pick a session that fits today.
            SamePace never ranks bodies or photos.
          </p>
          <Button className="mt-5" onClick={() => connect(true)}>
            Turn on Health
          </Button>
        </div>
      ) : (
        <>
          <div className="glass flex items-center gap-5 rounded-[28px] p-5">
            <ActivityRings
              size={140}
              move={health.moveKcal / health.moveGoal}
              exercise={health.exerciseMin / health.exerciseGoal}
              stand={health.standHours / health.standGoal}
            />
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

          <div className="grid grid-cols-2 gap-2">
            <Vital label="Sleep" value={formatSleep(health.sleepMin)} />
            <Vital label="HRV" value={`${health.hrvMs} ms`} />
            <Vital label="Resting HR" value={`${health.rhr} bpm`} />
            <Vital label="Recovery" value={`${health.recoveryPct}%`} />
          </div>

          <div className="glass rounded-[28px] p-4">
            <p className="text-sm text-muted">Move · 7 days</p>
            <div className="mt-2 h-28">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id="moveFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FA2D55" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#FA2D55" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="kcal"
                    stroke="#FA2D55"
                    fill="url(#moveFill)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <section>
            <h2 className="mb-3 text-lg font-semibold tracking-tight">Workouts</h2>
            <div className="flex flex-col gap-2">
              {health.workouts.map((w) => (
                <div key={w.id} className="glass flex items-center justify-between rounded-2xl px-4 py-3">
                  <div>
                    <p className="font-medium tracking-tight">{w.title}</p>
                    <p className="text-xs text-muted">
                      {ACTIVITIES[w.activity].label} · <When iso={w.at} /> · {w.minutes} min
                      {w.source === "pace" ? " · SamePace" : " · Fitness"}
                    </p>
                  </div>
                  <p className="text-sm tabular-nums text-muted">{w.kcal} kcal</p>
                </div>
              ))}
            </div>
          </section>

          <p className="text-sm text-muted">
            Completing a dual check-in writes a workout back to Fitness.{" "}
            <Link to="/prototype" className="text-fg">
              Today
            </Link>
          </p>
          <Button variant="ghost" onClick={() => connect(false)}>
            Disconnect Health
          </Button>
        </>
      )}
    </div>
  );
}

function Vital({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}
