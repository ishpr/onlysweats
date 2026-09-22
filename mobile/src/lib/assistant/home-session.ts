import type { Booking, Session } from "../types.ts";

/** Historical and cancelled bookings must not become an upcoming commitment. */
export function nextAgentSession(
  ownerId: string,
  sessions: Session[],
  bookings: Booking[],
  now: number,
) {
  const plans = sessions
    .filter(
      (session) =>
        session.status === "open" &&
        Date.parse(session.startAt) + session.durationMin * 60_000 > now,
    )
    .flatMap((session) => {
      const hosting = session.hostId === ownerId;
      const booking = bookings.find(
        (candidate) =>
          candidate.sessionId === session.id &&
          candidate.hostId === session.hostId &&
          (hosting
            ? candidate.status === "confirmed"
            : candidate.participantId === ownerId &&
              (candidate.status === "confirmed" || candidate.status === "pending")),
      );
      return hosting || booking ? [{ session, booking, hosting }] : [];
    })
    .sort((a, b) => Date.parse(a.session.startAt) - Date.parse(b.session.startAt));
  return plans[0];
}
