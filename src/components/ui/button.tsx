import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "glass" | "accent" | "ghost" | "danger" | "soft";

const styles: Record<Variant, string> = {
  primary:
    "bg-fg text-bg hover:bg-fg/90",
  glass:
    "glass text-fg hover:bg-fg/10",
  accent:
    "bg-accent text-accent-fg hover:bg-accent/90",
  ghost:
    "bg-transparent text-fg hover:bg-fg/8",
  danger:
    "bg-danger text-fg hover:bg-danger/90",
  soft:
    "bg-fg/8 text-fg hover:bg-fg/12",
};

export function Button({
  className,
  variant = "primary",
  static: isStatic,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  static?: boolean;
}) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-medium tracking-tight",
        "transition-[transform,opacity,background-color] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "disabled:pointer-events-none disabled:opacity-40",
        !isStatic && "active:not-disabled:scale-[0.96]",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}
