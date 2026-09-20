import { create } from "zustand";
import {
  buildHealth,
  buildSeedBookings,
  buildSeedMessages,
  buildSeedSessions,
  people,
} from "./seed";
import { hasStarted, isInCheckinWindow, isLateCancel } from "./time";
import type {
  Booking,
  ChatMessage,
  CheckinMethod,
  HealthSnapshot,
  PacePrefs,
  Rating,
  Session,
} from "./types";
import { GEOFENCE_M, ME_ID } from "./types";
import { uid } from "./utils";

export type PaceState = {
  hydrated: boolean;
  sessions: Session[];
  bookings: Booking[];
  messages: ChatMessage[];
  ratings: Rating[];
  health: HealthSnapshot;
  prefs: PacePrefs;
  creditCents: number;
  distanceM: number;
  hostArriving: Record<string, boolean>;
  markHydrated: () => void;
  alignToNow: () => void;
  bookSeat: (sessionId: string) => { ok: true; bookingId: string } | { ok: false; error: string };
  cancelBooking: (bookingId: string) => void;
  approveBooking: (bookingId: string) => { ok: boolean; error?: string };
  declineBooking: (bookingId: string) => void;
  postSession: (input: Omit<Session, "id" | "status" | "code" | "codeRevealedAt">) => string;
  revealCode: (sessionId: string) => string;
  checkIn: (bookingId: string, method: CheckinMethod) => void;
  submitCode: (bookingId: string, code: string) => { ok: boolean; error?: string };
  setDistance: (m: number) => void;
  sendMessage: (bookingId: string, text: string) => void;
  submitRating: (rating: Omit<Rating, "id">) => void;
  connectHealth: (on: boolean) => void;
  setPref: (patch: Partial<PacePrefs>) => void;
  inviteUnlisted: (input: {
    title: string;
    venueId: string;
    activity: Session["activity"];
    startAt: string;
    durationMin: number;
    priceCents: number;
  }) => string;
  addPaceWorkout: (session: Session) => void;
};

function seatsTaken(sessionId: string, bookings: Booking[]) {
  return bookings.filter(
    (b) =>
      b.sessionId === sessionId &&
      (b.status === "confirmed" || b.status === "pending" || b.status === "completed"),
  ).length;
}

function paidTogether(hostId: string, participantId: string, bookings: Booking[], sessions: Session[]) {
  return bookings.filter((b) => {
    if (b.status !== "completed" || b.capturedCents <= 0) return false;
    const s = sessions.find((x) => x.id === b.sessionId);
    if (!s) return false;
    const pair =
      (s.hostId === hostId && b.participantId === participantId) ||
      (s.hostId === participantId && b.participantId === hostId);
    return pair;
  }).length;
}

function completeIfDual(booking: Booking): Booking {
  if (booking.hostCheckedInAt && booking.participantCheckedInAt && booking.status === "confirmed") {
    return {
      ...booking,
      status: "completed",
      capturedCents: booking.authorizedCents,
    };
  }
  return booking;
}

export function seatsLeft(session: Session, bookings: Booking[]) {
  return Math.max(0, session.capacity - 1 - seatsTaken(session.id, bookings));
}

export const usePaceStore = create<PaceState>()((set, get) => ({
      hydrated: false,
      sessions: buildSeedSessions(new Date()),
      bookings: buildSeedBookings(new Date()),
      messages: buildSeedMessages(new Date()),
      ratings: [],
      health: buildHealth(new Date()),
      prefs: { womenOnlySearch: false, shareHealth: true },
      creditCents: 0,
      distanceM: 280,
      hostArriving: {},
      markHydrated: () => set({ hydrated: true }),
      alignToNow: () => {
        const now = new Date();
        const seeded = buildSeedSessions(now);
        const { sessions, bookings } = get();
        const byId = new Map(sessions.map((s) => [s.id, s]));
        const next = seeded.map((fresh) => {
          const prev = byId.get(fresh.id);
          if (!prev) return fresh;
          const done = bookings.some(
            (b) => b.sessionId === fresh.id && b.status === "completed",
          );
          if (done) return prev;
          return {
            ...prev,
            startAt: fresh.startAt,
            status: fresh.seedSlot === "live" ? "live" : prev.status,
          };
        });
        const extras = sessions.filter((s) => !s.seedSlot);
        set({ sessions: [...next, ...extras] });
      },
      bookSeat: (sessionId) => {
        const { sessions, bookings } = get();
        const session = sessions.find((s) => s.id === sessionId);
        if (!session) return { ok: false, error: "Listing is gone." };
        if (session.hostId === ME_ID) return { ok: false, error: "You’re hosting this one." };
        if (session.status === "cancelled" || session.status === "completed") {
          return { ok: false, error: "This listing is closed." };
        }
        if (hasStarted(session.startAt)) {
          return { ok: false, error: "This one already started." };
        }
        if (bookings.some((b) => b.sessionId === sessionId && b.participantId === ME_ID && b.status !== "cancelled" && b.status !== "declined")) {
          return { ok: false, error: "You already have a seat." };
        }
        if (seatsLeft(session, bookings) <= 0) return { ok: false, error: "No seats left." };
        const instant = session.joinMode === "instant";
        const booking: Booking = {
          id: uid("bk"),
          sessionId,
          participantId: ME_ID,
          status: instant ? "confirmed" : "pending",
          authorizedCents: session.priceCents,
          capturedCents: 0,
          createdAt: new Date().toISOString(),
          hostCheckedInAt: null,
          participantCheckedInAt: null,
          checkinMethod: null,
          ratedByParticipant: false,
          ratedByHost: false,
        };
        const msgs: ChatMessage[] = instant
          ? [
              {
                id: uid("m"),
                bookingId: booking.id,
                fromId: session.hostId,
                text: "Seat is yours. Exact pin is on the listing. See you at the trailhead.",
                createdAt: new Date().toISOString(),
              },
            ]
          : [
              {
                id: uid("m"),
                bookingId: booking.id,
                fromId: session.hostId,
                text: "Request received. I’ll confirm if the seat still fits.",
                createdAt: new Date().toISOString(),
              },
            ];
        set({
          bookings: [...bookings, booking],
          messages: [...get().messages, ...msgs],
        });
        return { ok: true, bookingId: booking.id };
      },
      cancelBooking: (bookingId) => {
        const { bookings, sessions } = get();
        const booking = bookings.find((b) => b.id === bookingId);
        if (!booking) return;
        if (booking.status !== "pending" && booking.status !== "confirmed") return;
        const session = sessions.find((s) => s.id === booking.sessionId);
        if (!session) return;
        // A pending request was never accepted, so nothing is held against it.
        const late =
          booking.status === "confirmed" &&
          isLateCancel(session.startAt) &&
          booking.authorizedCents > 0;
        const captured = late ? Math.round(booking.authorizedCents * 0.5) : 0;
        set({
          bookings: bookings.map((b) =>
            b.id === bookingId
              ? { ...b, status: "cancelled", capturedCents: captured }
              : b,
          ),
        });
      },
      approveBooking: (bookingId) => {
        const { bookings, sessions } = get();
        const booking = bookings.find((b) => b.id === bookingId);
        if (!booking || booking.status !== "pending") {
          return { ok: false, error: "No request to approve." };
        }
        const session = sessions.find((s) => s.id === booking.sessionId);
        if (!session || session.hostId !== ME_ID) {
          return { ok: false, error: "Only the host can approve." };
        }
        const confirmed = bookings.filter(
          (b) =>
            b.sessionId === session.id &&
            (b.status === "confirmed" || b.status === "completed"),
        ).length;
        if (confirmed >= session.capacity - 1) {
          return { ok: false, error: "No seats left." };
        }
        set({
          bookings: bookings.map((b) =>
            b.id === bookingId ? { ...b, status: "confirmed" } : b,
          ),
        });
        return { ok: true };
      },
      declineBooking: (bookingId) => {
        const { bookings, sessions } = get();
        const booking = bookings.find((b) => b.id === bookingId);
        if (!booking || booking.status !== "pending") return;
        const session = sessions.find((s) => s.id === booking.sessionId);
        if (!session || session.hostId !== ME_ID) return;
        set({
          bookings: bookings.map((b) =>
            b.id === bookingId ? { ...b, status: "declined" } : b,
          ),
        });
      },
      postSession: (input) => {
        const id = uid("ses");
        const code = String(Math.floor(1000 + Math.random() * 9000));
        const session: Session = {
          ...input,
          id,
          status: "open",
          code,
          codeRevealedAt: null,
          inviteCode: input.visibility === "unlisted" ? uid("inv").replace(/^inv[-_]?/, "") : undefined,
        };
        set({ sessions: [session, ...get().sessions] });
        return id;
      },
      revealCode: (sessionId) => {
        const session = get().sessions.find((s) => s.id === sessionId);
        if (!session) return "";
        set({
          sessions: get().sessions.map((s) =>
            s.id === sessionId
              ? { ...s, codeRevealedAt: new Date().toISOString() }
              : s,
          ),
        });
        return session.code;
      },
      setDistance: (m) => set({ distanceM: Math.max(8, Math.round(m)) }),
      checkIn: (bookingId, method) => {
        const { bookings, sessions, distanceM } = get();
        const booking = bookings.find((b) => b.id === bookingId);
        if (!booking) return;
        const session = sessions.find((s) => s.id === booking.sessionId);
        if (!session) return;
        if (!isInCheckinWindow(session.startAt)) return;
        if (method === "geo" && distanceM > GEOFENCE_M) return;
        const mine =
          booking.participantId === ME_ID
            ? {
                ...booking,
                participantCheckedInAt: new Date().toISOString(),
                checkinMethod: method,
              }
            : {
                ...booking,
                hostCheckedInAt: new Date().toISOString(),
                checkinMethod: method,
              };
        const next = completeIfDual(mine);
        set({
          bookings: bookings.map((b) => (b.id === bookingId ? next : b)),
          hostArriving: { ...get().hostArriving, [bookingId]: true },
        });
        if (booking.participantId === ME_ID && !booking.hostCheckedInAt) {
          window.setTimeout(() => {
            const current = get().bookings.find((b) => b.id === bookingId);
            if (!current || current.hostCheckedInAt) return;
            const withHost = completeIfDual({
              ...current,
              hostCheckedInAt: new Date().toISOString(),
            });
            set({
              bookings: get().bookings.map((b) =>
                b.id === bookingId ? withHost : b,
              ),
            });
            if (withHost.status === "completed") {
              const ses = get().sessions.find((s) => s.id === withHost.sessionId);
              if (ses) get().addPaceWorkout(ses);
            }
          }, 1600);
        }
        if (next.status === "completed") {
          get().addPaceWorkout(session);
        }
      },
      submitCode: (bookingId, code) => {
        const { bookings, sessions } = get();
        const booking = bookings.find((b) => b.id === bookingId);
        if (!booking) return { ok: false, error: "No booking." };
        const session = sessions.find((s) => s.id === booking.sessionId);
        if (!session) return { ok: false, error: "No session." };
        if (!session.codeRevealedAt) {
          return { ok: false, error: "Host hasn’t revealed the code." };
        }
        const age = Date.now() - new Date(session.codeRevealedAt).getTime();
        if (age > 10 * 60 * 1000) return { ok: false, error: "Code expired." };
        if (code.trim() !== session.code) return { ok: false, error: "Code doesn’t match." };
        get().checkIn(bookingId, "code");
        return { ok: true };
      },
      sendMessage: (bookingId, text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        set({
          messages: [
            ...get().messages,
            {
              id: uid("m"),
              bookingId,
              fromId: ME_ID,
              text: trimmed,
              createdAt: new Date().toISOString(),
            },
          ],
        });
      },
      submitRating: (rating) => {
        set({
          ratings: [...get().ratings, { ...rating, id: uid("rt") }],
          bookings: get().bookings.map((b) =>
            b.id === rating.bookingId
              ? rating.fromId === ME_ID
                ? { ...b, ratedByParticipant: true }
                : { ...b, ratedByHost: true }
              : b,
          ),
        });
      },
      connectHealth: (on) =>
        set({
          health: { ...get().health, connected: on },
          prefs: { ...get().prefs, shareHealth: on },
        }),
      setPref: (patch) => set({ prefs: { ...get().prefs, ...patch } }),
      inviteUnlisted: (input) => {
        return get().postSession({
          hostId: ME_ID,
          venueId: input.venueId,
          activity: input.activity,
          title: input.title,
          detail: "Unlisted invite. Shared from Messages.",
          startAt: input.startAt,
          durationMin: input.durationMin,
          capacity: 2,
          priceCents: input.priceCents,
          visibility: "unlisted",
          joinMode: "instant",
          womenOnly: false,
          hostAttestsPaidOk: true,
        });
      },
      addPaceWorkout: (session) => {
        const { health } = get();
        if (health.workouts.some((w) => w.id === `pace-${session.id}`)) return;
        const host = people.find((p) => p.id === session.hostId);
        set({
          health: {
            ...health,
            exerciseMin: Math.min(
              health.exerciseGoal,
              health.exerciseMin + Math.round(session.durationMin * 0.6),
            ),
            moveKcal: Math.min(
              health.moveGoal + 80,
              health.moveKcal + Math.round(session.durationMin * 8),
            ),
            workouts: [
              {
                id: `pace-${session.id}`,
                source: "pace",
                activity: session.activity,
                title: `${session.title}${host ? ` with ${host.name.split(" ")[0]}` : ""}`,
                at: new Date().toISOString(),
                minutes: session.durationMin,
                kcal: Math.round(session.durationMin * 8.2),
                avgHr: 138,
                distanceKm:
                  session.activity === "run" || session.activity === "hike"
                    ? Number((session.durationMin / 6.2).toFixed(1))
                    : undefined,
              },
              ...health.workouts,
            ],
          },
          sessions: get().sessions.map((s) =>
            s.id === session.id ? { ...s, status: "completed" } : s,
          ),
        });
      },
    }),
);

export function useMe() {
  return people.find((p) => p.id === ME_ID)!;
}

export { people };
export { paidTogether, seatsTaken };
