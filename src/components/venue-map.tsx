import { venueById, venues } from "@/lib/seed";
import type { Session } from "@/lib/types";
import { cn } from "@/lib/utils";

const BOUNDS = {
  minLat: 32.69,
  maxLat: 32.87,
  minLng: -96.86,
  maxLng: -96.69,
};

export function project(lat: number, lng: number) {
  const x = ((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * 100;
  const y = (1 - (lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * 100;
  return { x, y };
}

export function ClusterMap({
  sessions,
  activeId,
  onSelect,
  approximate = true,
}: {
  sessions: Session[];
  activeId?: string;
  onSelect?: (id: string) => void;
  approximate?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-bg-elevated hairline">
      <svg viewBox="0 0 400 280" className="block h-auto w-full">
        <defs>
          <radialGradient id="lake" cx="72%" cy="28%" r="22%">
            <stop offset="0%" stopColor="#64d2ff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#64d2ff" stopOpacity="0.05" />
          </radialGradient>
        </defs>
        <rect width="400" height="280" fill="#0c0c0e" />
        {Array.from({ length: 10 }).map((_, i) => (
          <line
            key={`h${i}`}
            x1="0"
            y1={20 + i * 26}
            x2="400"
            y2={28 + i * 26}
            stroke="rgba(245,245,247,0.04)"
            strokeWidth="1"
          />
        ))}
        {Array.from({ length: 12 }).map((_, i) => (
          <line
            key={`v${i}`}
            x1={18 + i * 32}
            y1="0"
            x2={10 + i * 32}
            y2="280"
            stroke="rgba(245,245,247,0.035)"
            strokeWidth="1"
          />
        ))}
        <ellipse cx="292" cy="78" rx="54" ry="32" fill="url(#lake)" />
        <path
          d="M48 20 C 70 80, 40 140, 78 210 S 40 270, 90 280"
          fill="none"
          stroke="rgba(100,210,255,0.18)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <text
          x="20"
          y="264"
          fill="rgba(245,245,247,0.35)"
          fontSize="10"
          fontFamily="Outfit, sans-serif"
        >
          Dallas cluster · Oak Lawn
        </text>
        {sessions.map((s) => {
          const v = venueById(s.venueId);
          if (!v) return null;
          const p = project(v.lat, v.lng);
          const jitter = approximate ? 6 : 0;
          const x = 4 + p.x * 3.92 + (s.id.length % 3) * (jitter / 3);
          const y = 4 + p.y * 2.72;
          const active = s.id === activeId;
          return (
            <g
              key={s.id}
              transform={`translate(${x} ${y})`}
              className={onSelect ? "cursor-pointer" : undefined}
              onClick={() => onSelect?.(s.id)}
            >
              {active && (
                <circle r="16" fill="none" stroke="#30d158" strokeOpacity="0.45" />
              )}
              <circle
                r={active ? 7 : 5.5}
                fill={active ? "#30d158" : "#f5f5f7"}
              />
            </g>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute right-3 top-3 rounded-full glass px-2.5 py-1 text-[11px] text-muted">
        {approximate ? "Approximate pin" : "Exact pin"}
      </div>
    </div>
  );
}

export function VenuePinsLegend() {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {venues.map((v) => (
        <span
          key={v.id}
          className={cn("rounded-full bg-fg/6 px-2.5 py-1 text-[11px] text-muted")}
        >
          {v.neighborhood}
        </span>
      ))}
    </div>
  );
}
