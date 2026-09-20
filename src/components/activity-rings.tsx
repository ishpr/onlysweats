import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

type Rings = {
  move: number;
  exercise: number;
  stand: number;
  size?: number;
  className?: string;
};

function Ring({
  r,
  progress,
  color,
  width,
  delay,
}: {
  r: number;
  progress: number;
  color: string;
  width: number;
  delay: number;
}) {
  const c = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, progress));
  const left = c * (1 - p);
  return (
    <circle
      cx="70"
      cy="70"
      r={r}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeDasharray={c}
      strokeDashoffset={left}
      transform="rotate(-90 70 70)"
      style={
        {
          "--ring-len": c,
          "--ring-left": left,
          animation: `ring-draw 900ms cubic-bezier(0.22,1,0.36,1) ${delay}ms both`,
        } as CSSProperties
      }
    />
  );
}

export function ActivityRings({
  move,
  exercise,
  stand,
  size = 148,
  className,
}: Rings) {
  return (
    <svg
      viewBox="0 0 140 140"
      width={size}
      height={size}
      className={cn("overflow-visible", className)}
      aria-hidden
    >
      <circle cx="70" cy="70" r="58" fill="none" stroke="rgba(250,45,85,0.16)" strokeWidth="12" />
      <circle cx="70" cy="70" r="42" fill="none" stroke="rgba(123,245,66,0.14)" strokeWidth="12" />
      <circle cx="70" cy="70" r="26" fill="none" stroke="rgba(100,210,255,0.16)" strokeWidth="12" />
      <Ring r={58} progress={move} color="#FA2D55" width={12} delay={0} />
      <Ring r={42} progress={exercise} color="#7BF542" width={12} delay={90} />
      <Ring r={26} progress={stand} color="#64D2FF" width={12} delay={180} />
    </svg>
  );
}

export function RingLegend({
  move,
  exercise,
  stand,
  moveKcal,
  moveGoal,
  exerciseMin,
  exerciseGoal,
  standHours,
  standGoal,
}: {
  move: number;
  exercise: number;
  stand: number;
  moveKcal: number;
  moveGoal: number;
  exerciseMin: number;
  exerciseGoal: number;
  standHours: number;
  standGoal: number;
}) {
  const rows = [
    { label: "Move", value: `${moveKcal}`, unit: `/ ${moveGoal} kcal`, color: "text-move", pct: move },
    { label: "Exercise", value: `${exerciseMin}`, unit: `/ ${exerciseGoal} min`, color: "text-exercise", pct: exercise },
    { label: "Stand", value: `${standHours}`, unit: `/ ${standGoal} hrs`, color: "text-stand", pct: stand },
  ];
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <div key={r.label} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className={cn("text-sm font-semibold", r.color)}>{r.label}</span>
            <span className="text-sm tabular-nums text-muted">
              <span className="text-fg">{r.value}</span>
              {r.unit}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
