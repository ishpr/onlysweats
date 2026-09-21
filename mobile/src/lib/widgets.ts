/**
 * Keeps the Home Screen widget and the Live Activity in step with what the app
 * already knows. Nothing here talks to the server: it projects `/bookings` data
 * onto the two surfaces whenever that data changes.
 *
 * `expo-widgets` is a native module (iOS; a no-op stub on Android). The widget
 * definitions register with it at import, so they're required lazily — a build
 * made before the module was added just doesn't have these surfaces.
 */
import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

import { formatWhen } from "./format";
import { firstName } from "./names";
import { setBadge } from "./push";
import { setNextSessionShortcut } from "./intelligence";
import { workoutSurface, type WorkoutSurfaceSnapshot } from "./intelligence/workout-surface";
import type { Booking, Person, Session, Venue } from "./types";
import type { LiveSessionProps } from "@/widgets/live-session";
import type { NextSessionProps } from "@/widgets/next-session";

type Surfaces = {
  next: typeof import("@/widgets/next-session").default;
  live: typeof import("@/widgets/live-session").default;
  workout: typeof import("@/widgets/active-workout").default;
  after: typeof import("expo-widgets").after;
};

let cached: Surfaces | null | undefined;

function load(): Surfaces | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS !== "ios") return cached;
  // Ask before loading: in development a failed `require` is reported as fatal by
  // the bundler before any try/catch here could see it.
  if (!requireOptionalNativeModule("ExpoWidgets")) return cached;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports -- optional native module */
    const { after } = require("expo-widgets") as typeof import("expo-widgets");
    const next = (require("@/widgets/next-session") as typeof import("@/widgets/next-session"))
      .default;
    const live = (require("@/widgets/live-session") as typeof import("@/widgets/live-session"))
      .default;
    const workout = (
      require("@/widgets/active-workout") as typeof import("@/widgets/active-workout")
    ).default;
    /* eslint-enable @typescript-eslint/no-require-imports */
    cached = { next, live, workout, after };
  } catch {
    cached = null;
  }
  return cached;
}

const CHECKIN_BEFORE_MS = 20 * 60_000;
const CHECKIN_AFTER_MS = 25 * 60_000;
const EMPTY: NextSessionProps = {
  title: "",
  when: "",
  startAt: 0,
  venue: "",
  level: "",
  status: "",
  url: "samepace://sessions",
};

export type MineSnapshot = {
  meId: string;
  bookings: Booking[];
  sessions: Session[];
  people: Person[];
  venues: Map<string, Venue>;
};

type Seat = { booking?: Booking; session: Session; status: string };

/** My upcoming sessions, joined or hosted — a session I posted counts before anyone joins it. */
function upcomingSeats(snap: MineSnapshot, now: number): Seat[] {
  const active = snap.bookings.filter((b) => b.status === "confirmed" || b.status === "pending");
  return snap.sessions
    .filter((s) => s.status === "open" && +new Date(s.startAt) + s.durationMin * 60_000 > now)
    .flatMap((session): Seat[] => {
      const seats = active.filter((b) => b.sessionId === session.id);
      if (session.hostId === snap.meId) {
        return [
          { session, booking: seats.find((b) => b.status === "confirmed"), status: "Hosting" },
        ];
      }
      const mine = seats.find((b) => b.participantId === snap.meId);
      if (!mine) return [];
      return [{ session, booking: mine, status: mine.status === "pending" ? "Waiting" : "Joined" }];
    })
    .sort((a, b) => +new Date(a.session.startAt) - +new Date(b.session.startAt));
}

function widgetProps(seat: Seat, snap: MineSnapshot): NextSessionProps {
  const { session } = seat;
  return {
    title: session.title,
    when: formatWhen(session.startAt),
    startAt: +new Date(session.startAt),
    venue: snap.venues.get(session.venueId)?.name ?? "",
    level: session.abilityLabel,
    status: seat.status,
    url: `samepace://session/${session.id}`,
  };
}

/**
 * A timeline, not a snapshot: the widget moves on to the following session (or to
 * "nothing booked") when each one ends, without the app having to be opened.
 */
export function syncNextSessionWidget(snap: MineSnapshot, now = Date.now()) {
  const seats = upcomingSeats(snap, now).slice(0, 6);
  const next = seats[0];
  void setNextSessionShortcut(
    next ? `samepace://session/${next.session.id}` : null,
    next ? +new Date(next.session.startAt) + next.session.durationMin * 60_000 : null,
  );
  const surfaces = load();
  if (!surfaces) return;
  try {
    const entries: { date: Date; props: NextSessionProps }[] = [];
    let from = now;
    for (const seat of seats) {
      entries.push({ date: new Date(from), props: widgetProps(seat, snap) });
      from = +new Date(seat.session.startAt) + seat.session.durationMin * 60_000;
    }
    entries.push({ date: new Date(from), props: EMPTY });
    surfaces.next.updateTimeline(entries);
  } catch {
    /* a widget is a convenience — never let it break the screen that feeds it */
  }
}

/** Signed out, or the account is gone: the widget says nothing about anyone. */
export function clearWidgets() {
  setBadge(0);
  void setNextSessionShortcut(null, null);
  running.clear();
  activeWorkout = null;
  surfaceOwner = null;
  const surfaces = load();
  if (!surfaces) return;
  try {
    surfaces.next.updateSnapshot(EMPTY);
    for (const activity of [...surfaces.live.getInstances(), ...surfaces.workout.getInstances()])
      void activity.end("immediate").catch(() => undefined);
  } catch {
    /* see above */
  }
}

// ── Live Activity ────────────────────────────────────────────────────────────

type Running = { activity: ReturnType<Surfaces["live"]["start"]>; key: string; endedAt?: number };
const running = new Map<string, Running>();
let adopted = false;
let surfaceOwner: string | null = null;
let activeWorkout: {
  sessionId: string;
  activity: ReturnType<Surfaces["workout"]["start"]>;
  key: string;
  staleAt: number;
  ending?: boolean;
} | null = null;

function ownSurfaces(ownerId: string, surfaces: Surfaces) {
  if (surfaceOwner === ownerId) return;
  for (const activity of [...surfaces.live.getInstances(), ...surfaces.workout.getInstances()])
    void activity.end("immediate").catch(() => undefined);
  running.clear();
  activeWorkout = null;
  surfaceOwner = ownerId;
  adopted = true;
}

/** Explicit native readings only. One current workout takes precedence over arrival.
 * A stale timestamp prevents a stopped Watch connection appearing as live data. */
export function syncWorkoutLiveActivity(
  ownerId: string,
  snapshot: WorkoutSurfaceSnapshot | null,
  now = Date.now(),
) {
  const surfaces = load();
  if (!surfaces) return;
  try {
    ownSurfaces(ownerId, surfaces);
    const projected = snapshot ? workoutSurface(snapshot, now) : null;
    if (!projected || !snapshot) {
      if (activeWorkout) void activeWorkout.activity.end("immediate").catch(() => undefined);
      activeWorkout = null;
      return;
    }
    for (const { activity } of running.values())
      void activity.end("immediate").catch(() => undefined);
    running.clear();
    if (activeWorkout && activeWorkout.sessionId !== snapshot.sessionId) {
      void activeWorkout.activity.end("immediate").catch(() => undefined);
      activeWorkout = null;
    }
    const key = JSON.stringify(projected);
    if (!activeWorkout) {
      activeWorkout = {
        sessionId: snapshot.sessionId,
        key,
        staleAt: projected.staleAt,
        activity: surfaces.workout.start(
          projected.props,
          "samepace://health",
          new Date(projected.staleAt),
        ),
      };
    } else if (!activeWorkout.ending && activeWorkout.key !== key) {
      const current = activeWorkout;
      void current.activity.update(projected.props, new Date(projected.staleAt)).catch(() => {
        // Retain the handle until native retirement succeeds, so another
        // snapshot cannot start a duplicate after a transient update failure.
        current.ending = true;
        void current.activity
          .end("immediate")
          .then(() => {
            if (activeWorkout === current) activeWorkout = null;
          })
          .catch(() => {
            current.ending = false;
            current.key = "";
          });
      });
      current.key = key;
      current.staleAt = projected.staleAt;
    }
  } catch {
    /* The member or system can deny Live Activities without interrupting a workout. */
  }
}
export type { WorkoutSurfaceSnapshot } from "./intelligence/workout-surface";

/**
 * One current arrival Live Activity inside its check-in window. Started when the
 * window opens (while the app is open), updated as each side checks in, ended a
 * few minutes after both have — or when the window shuts.
 */
export function syncLiveActivity(snap: MineSnapshot, now = Date.now()) {
  const surfaces = load();
  if (!surfaces) return;
  try {
    ownSurfaces(snap.meId, surfaces);
    if (activeWorkout && activeWorkout.staleAt > now) return;
    if (activeWorkout) {
      void activeWorkout.activity.end("immediate").catch(() => undefined);
      activeWorkout = null;
    }
    // After a relaunch we can't tell which seat an old activity belonged to.
    if (!adopted) {
      adopted = true;
      for (const stale of surfaces.live.getInstances())
        void stale.end("immediate").catch(() => undefined);
    }
    const sessions = new Map(snap.sessions.map((s) => [s.id, s]));
    const people = new Map(snap.people.map((p) => [p.id, p]));
    const wanted = new Set<string>();

    const sorted = [...snap.bookings].sort(
      (a, b) =>
        +new Date(sessions.get(a.sessionId)?.startAt ?? 0) -
          +new Date(sessions.get(b.sessionId)?.startAt ?? 0) || a.id.localeCompare(b.id),
    );
    for (const b of sorted) {
      if (wanted.size > 0) break;
      if (b.hostId !== snap.meId && b.participantId !== snap.meId) continue;
      const s = sessions.get(b.sessionId);
      if (!s) continue;
      const startAt = +new Date(s.startAt);
      const closesAt = startAt + CHECKIN_AFTER_MS;
      const inWindow = now >= startAt - CHECKIN_BEFORE_MS && now <= closesAt;
      const live =
        (b.status === "confirmed" && inWindow) ||
        (b.status === "completed" &&
          running.has(b.id) &&
          now < (running.get(b.id)?.endedAt ?? Infinity));
      if (!live) continue;
      wanted.add(b.id);

      const isHost = b.hostId === snap.meId;
      const other = people.get(isHost ? b.participantId : b.hostId);
      const props: LiveSessionProps = {
        title: s.title,
        venue: snap.venues.get(s.venueId)?.name ?? "",
        other: firstName(other?.name) ?? "your buddy",
        startAt,
        closesAt,
        meIn: Boolean(isHost ? b.hostCheckedInAt : b.participantCheckedInAt),
        themIn: Boolean(isHost ? b.participantCheckedInAt : b.hostCheckedInAt),
      };
      const key = JSON.stringify({ props, status: b.status });
      const current = running.get(b.id);

      if (b.status === "completed") {
        if (current && current.key !== key) {
          void current.activity
            .end(surfaces.after(new Date(now + 5 * 60_000)), props)
            .catch(() => undefined);
          running.set(b.id, { ...current, key, endedAt: now + 5 * 60_000 });
        }
        continue;
      }
      if (!current) {
        const activity = surfaces.live.start(props, `samepace://live/${b.id}`, new Date(closesAt));
        running.set(b.id, { activity, key });
      } else if (current.key !== key) {
        void current.activity.update(props, new Date(closesAt)).catch(() => {
          void current.activity
            .end("immediate")
            .then(() => {
              // A late rejection must never discard a replacement instance
              // created after signing out or changing accounts.
              if (running.get(b.id)?.activity === current.activity) running.delete(b.id);
            })
            .catch(() => {
              const latest = running.get(b.id);
              if (latest?.activity === current.activity) latest.key = "";
            });
        });
        running.set(b.id, { ...current, key });
      }
    }

    for (const [bookingId, r] of running) {
      if (wanted.has(bookingId)) continue;
      void r.activity.end("immediate").catch(() => undefined);
      running.delete(bookingId);
    }
  } catch {
    /* Live Activities can be switched off in Settings; that's the member's call */
  }
}
