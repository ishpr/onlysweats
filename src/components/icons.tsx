import { cn } from "@/lib/utils";

export function PaceMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-8", className)}
      aria-hidden
    >
      <circle
        cx="16"
        cy="16"
        r="13"
        fill="none"
        stroke="currentColor"
        className="text-move"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeDasharray="62 20"
        transform="rotate(-90 16 16)"
      />
      <circle
        cx="16"
        cy="16"
        r="9.2"
        fill="none"
        stroke="currentColor"
        className="text-exercise"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeDasharray="42 16"
        transform="rotate(-90 16 16)"
      />
      <circle
        cx="16"
        cy="16"
        r="5.4"
        fill="none"
        stroke="currentColor"
        className="text-stand"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray="24 10"
        transform="rotate(-90 16 16)"
      />
    </svg>
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
