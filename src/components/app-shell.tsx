import { Link, useRouterState } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  MapPinned,
  MessageCircle,
  Plus,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { IntelligenceBloom, PaceMark } from "@/components/icons";
import { SiriSheet } from "@/components/siri-sheet";
import { isInCheckinWindow } from "@/lib/time";
import { ME_ID } from "@/lib/types";
import { cn } from "@/lib/utils";
import { usePaceStore } from "@/lib/store";

const NAV: {
  to: "/" | "/sessions" | "/inbox" | "/you";
  label: string;
  icon: LucideIcon;
  match?: string;
}[] = [
  { to: "/", label: "Today", icon: CalendarDays },
  { to: "/sessions", label: "Sessions", icon: MapPinned, match: "/sessions" },
  { to: "/inbox", label: "Inbox", icon: MessageCircle, match: "/inbox" },
  { to: "/you", label: "You", icon: UserRound, match: "/you" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hideChrome =
    pathname.startsWith("/live") || pathname.startsWith("/invite");
  const [siri, setSiri] = useState(false);
  const bookings = usePaceStore((s) => s.bookings);
  const sessions = usePaceStore((s) => s.sessions);
  const unread = bookings.filter(
    (b) =>
      b.participantId === ME_ID &&
      (b.status === "pending" || b.status === "confirmed"),
  ).length;

  const live = sessions.find((s) => {
    const mine = bookings.find(
      (b) =>
        b.sessionId === s.id &&
        b.participantId === ME_ID &&
        b.status === "confirmed",
    );
    const hosting = s.hostId === ME_ID;
    return (mine || hosting) && isInCheckinWindow(s.startAt);
  });

  if (hideChrome) return <>{children}</>;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-fg/8 px-4 py-6 md:flex">
        <Link to="/" className="mb-8 flex items-center gap-2 px-2">
          <PaceMark />
          <span className="text-lg font-semibold tracking-tight">Pace</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => {
            const active =
              item.to === "/"
                ? pathname === "/"
                : pathname.startsWith(item.match ?? item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                preload="intent"
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-2xl px-3 text-[15px] font-medium",
                  active ? "bg-fg/10 text-fg" : "text-muted hover:bg-fg/6 hover:text-fg",
                )}
              >
                <item.icon className="size-5" />
                {item.label}
                {item.to === "/inbox" && unread > 0 && (
                  <span className="ml-auto rounded-full bg-move px-1.5 text-[11px] text-fg">
                    {unread}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <Link
          to="/post"
          className="press mt-4 flex min-h-12 items-center justify-center gap-2 rounded-full bg-fg text-bg text-[15px] font-medium"
        >
          <Plus className="size-4" />
          Post a run
        </Link>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-bg/80 px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-xl md:px-8">
          <Link to="/" className="flex items-center gap-2 md:hidden">
            <PaceMark className="size-7" />
            <span className="text-[17px] font-semibold tracking-tight">Pace</span>
          </Link>
          <p className="hidden text-sm text-muted md:block">
            Dallas · Oak Lawn cluster
          </p>
          <button
            type="button"
            onClick={() => setSiri(true)}
            className="press glass ml-auto inline-flex size-11 items-center justify-center rounded-full"
            aria-label="Siri"
          >
            <IntelligenceBloom />
          </button>
        </header>

        {live && (
          <Link
            to="/live/$id"
            params={{ id: live.id }}
            className="mx-4 mt-2 flex items-center justify-between rounded-2xl bg-move px-4 py-3 text-sm font-medium text-fg md:mx-8"
          >
            Check-in is open
            <span className="text-fg/80">Live session</span>
          </Link>
        )}

        <div className="flex-1 px-4 pb-28 pt-4 md:px-8 md:pb-10">{children}</div>

        <nav className="tab-bar fixed inset-x-0 bottom-0 z-30 flex justify-around px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 md:hidden">
          {NAV.map((item) => {
            const active =
              item.to === "/"
                ? pathname === "/"
                : pathname.startsWith(item.match ?? item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex min-h-12 min-w-12 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
                  active ? "text-fg" : "text-faint",
                )}
              >
                <item.icon className="size-5" />
                {item.label}
              </Link>
            );
          })}
          <Link
            to="/post"
            className="flex min-h-12 min-w-12 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-accent"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-fg text-bg">
              <Plus className="size-4" />
            </span>
            Post
          </Link>
        </nav>
      </div>

      <SiriSheet open={siri} onClose={() => setSiri(false)} />
    </div>
  );
}

export function HydrateGate({ children }: { children: React.ReactNode }) {
  const markHydrated = usePaceStore((s) => s.markHydrated);
  const alignToNow = usePaceStore((s) => s.alignToNow);

  useEffect(() => {
    alignToNow();
    markHydrated();
  }, [alignToNow, markHydrated]);

  return <>{children}</>;
}
