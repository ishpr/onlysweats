import { cn } from "@/lib/utils";
import type { Accent } from "@/lib/types";

const ring: Record<Accent, string> = {
  move: "bg-move/20 text-move",
  exercise: "bg-exercise/15 text-exercise",
  stand: "bg-stand/20 text-stand",
  fg: "bg-fg/12 text-fg",
};

export function Avatar({
  initials,
  accent,
  size = "md",
  className,
}: {
  initials: string;
  accent: Accent;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-tight",
        size === "sm" && "size-8 text-[11px]",
        size === "md" && "size-11 text-[13px]",
        size === "lg" && "size-16 text-lg",
        ring[accent],
        className,
      )}
    >
      {initials}
    </div>
  );
}
