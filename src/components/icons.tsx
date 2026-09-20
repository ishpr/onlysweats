import { cn } from "@/lib/utils";

/** The SamePace mark: two people leaning in step. Geometry from brand/build.py. */
export function PaceMark({ className }: { className?: string }) {
  return (
    <svg viewBox="12 12 76 76" className={cn("size-8", className)} aria-hidden>
      <g transform="rotate(14 34.5 49.5)" className="fill-accent">
        <circle cx="34.5" cy="27" r="9" />
        <rect x="27" y="41" width="15" height="40" rx="7.5" />
      </g>
      <g transform="rotate(14 64.5 49.5)" className="fill-stand">
        <circle cx="64.5" cy="27" r="9" />
        <rect x="57" y="41" width="15" height="40" rx="7.5" />
      </g>
    </svg>
  );
}

/** Lowercase two-tone wordmark that sits beside the mark. */
export function PaceWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-semibold tracking-tight", className)}>
      same<span className="text-accent">pace</span>
    </span>
  );
}

export function IntelligenceBloom({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6", className)} aria-hidden>
      <path
        d="M12 3.2c.4 2.6 1.6 4.2 4.2 4.8-2.6.4-3.8 2-4.2 4.8-.4-2.6-1.6-4.2-4.2-4.8 2.6-.6 3.8-2.2 4.2-4.8Z"
        className="fill-stand"
      />
      <path
        d="M6.2 13.2c.3 1.8 1.1 2.9 2.9 3.3-1.8.3-2.6 1.4-2.9 3.3-.3-1.8-1.1-2.9-2.9-3.3 1.8-.4 2.6-1.5 2.9-3.3Z"
        className="fill-move"
      />
      <path
        d="M17.8 13.4c.25 1.6 1 2.6 2.6 2.95-1.6.25-2.35 1.25-2.6 2.95-.25-1.6-1-2.6-2.6-2.95 1.6-.35 2.35-1.35 2.6-2.95Z"
        className="fill-exercise"
      />
    </svg>
  );
}
