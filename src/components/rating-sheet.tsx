import { Button } from "@/components/ui/button";
import { usePaceStore } from "@/lib/store";
import { ME_ID } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useState } from "react";

const PROMPTS = [
  { key: "showedUp", label: "Showed up" },
  { key: "onTime", label: "On time" },
  { key: "matchedListing", label: "Matched the listing" },
  { key: "respectful", label: "Respectful" },
  { key: "wouldJoinAgain", label: "Would join again" },
] as const;

export function RatingSheet({
  bookingId,
  toId,
  onDone,
}: {
  bookingId: string;
  toId: string;
  onDone: () => void;
}) {
  const submit = usePaceStore((s) => s.submitRating);
  const [vals, setVals] = useState<Record<(typeof PROMPTS)[number]["key"], boolean>>({
    showedUp: true,
    onTime: true,
    matchedListing: true,
    respectful: true,
    wouldJoinAgain: true,
  });

  return (
    <div className="glass-strong rounded-[28px] p-5">
      <h3 className="text-lg font-semibold tracking-tight">After the session</h3>
      <p className="mt-1 text-sm text-muted">
        Five yes/no prompts. No body scores. No stars.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {PROMPTS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setVals((v) => ({ ...v, [p.key]: !v[p.key] }))}
            className={cn(
              "flex min-h-12 items-center justify-between rounded-2xl px-4 text-[15px]",
              vals[p.key] ? "bg-accent/15 text-fg" : "bg-fg/6 text-muted",
            )}
          >
            {p.label}
            <span className="text-sm font-medium">
              {vals[p.key] ? "Yes" : "No"}
            </span>
          </button>
        ))}
      </div>
      <Button
        className="mt-5 w-full"
        onClick={() => {
          submit({ bookingId, fromId: ME_ID, toId, ...vals });
          onDone();
        }}
      >
        Save
      </Button>
    </div>
  );
}
