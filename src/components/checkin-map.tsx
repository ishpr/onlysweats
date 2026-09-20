import { GEOFENCE_M } from "@/lib/types";
import { cn } from "@/lib/utils";
import { usePointerDrag } from "@/lib/use-pointer-drag";

export function CheckinMap({
  distanceM,
  onDistance,
}: {
  distanceM: number;
  onDistance: (m: number) => void;
}) {
  const inside = distanceM <= GEOFENCE_M;
  const scale = 150 / GEOFENCE_M;
  const px = Math.min(118, distanceM * scale);
  const angle = -38 * (Math.PI / 180);
  const ux = 140 + Math.cos(angle) * px;
  const uy = 140 + Math.sin(angle) * px;

  const bind = usePointerDrag((nx, ny) => {
    const dx = nx - 140;
    const dy = ny - 140;
    const m = Math.sqrt(dx * dx + dy * dy) / scale;
    onDistance(Math.min(420, m));
  });

  return (
    <div className="relative">
      <svg viewBox="0 0 280 280" className="block w-full">
        <defs>
          <radialGradient id="pinGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={inside ? "#30d158" : "#64d2ff"} stopOpacity="0.28" />
            <stop offset="70%" stopColor="#050506" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="280" height="280" rx="28" fill="#0c0c0e" />
        <circle cx="140" cy="140" r="120" fill="url(#pinGlow)" />
        {Array.from({ length: 6 }).map((_, i) => (
          <circle
            key={i}
            cx="140"
            cy="140"
            r={28 + i * 16}
            fill="none"
            stroke="rgba(245,245,247,0.06)"
          />
        ))}
        <circle
          cx="140"
          cy="140"
          r={GEOFENCE_M * scale}
          fill={inside ? "rgba(48,209,88,0.10)" : "rgba(100,210,255,0.08)"}
          stroke={inside ? "#30d158" : "#64d2ff"}
          strokeDasharray="6 6"
          strokeWidth="2"
        />
        <circle cx="140" cy="140" r="7" fill="#f5f5f7" />
        <circle
          cx={ux}
          cy={uy}
          r="11"
          fill={inside ? "#30d158" : "#fa2d55"}
          className="cursor-grab"
          {...bind}
        />
        <circle cx={ux} cy={uy} r="4" fill="#050506" pointerEvents="none" />
      </svg>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className={cn("tabular-nums font-medium", inside ? "text-accent" : "text-muted")}>
          {Math.round(distanceM)} m from pin
        </span>
        <span className="text-muted">{inside ? "Inside 150 m" : "Walk to the pin"}</span>
      </div>
    </div>
  );
}
