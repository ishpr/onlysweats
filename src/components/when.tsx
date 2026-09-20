import { formatWhen, greeting as greet } from "@/lib/time";

export function When({ iso, className }: { iso: string; className?: string }) {
  return (
    <span className={className} suppressHydrationWarning>
      {formatWhen(iso)}
    </span>
  );
}

export function Greeting() {
  return <span suppressHydrationWarning>{greet()}</span>;
}
