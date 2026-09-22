import assert from "node:assert/strict";
import test from "node:test";
import { nextAgentSession } from "./home-session.ts";

const now = Date.parse("2026-09-22T12:00:00Z");
const session = (id, extra = {}) => ({
  id,
  hostId: "host",
  startAt: new Date(now + 60_000).toISOString(),
  durationMin: 60,
  status: "open",
  ...extra,
});
const booking = (sessionId, extra = {}) => ({
  id: `b-${sessionId}`,
  sessionId,
  hostId: "host",
  participantId: "me",
  status: "confirmed",
  ...extra,
});

test("cancelled, rejected, unrelated and historical seats never become my next commitment", () => {
  const badStatuses = ["cancelled", "late_cancel", "rejected", "completed", "no_show"];
  for (const status of badStatuses)
    assert.equal(
      nextAgentSession("me", [session("one")], [booking("one", { status })], now),
      undefined,
    );
  assert.equal(
    nextAgentSession("me", [session("one")], [booking("one", { participantId: "other" })], now),
    undefined,
  );
  assert.equal(
    nextAgentSession("me", [session("one")], [booking("one", { hostId: "different" })], now),
    undefined,
  );
  for (const item of [
    session("one", { status: "cancelled" }),
    session("one", { startAt: new Date(now - 3_600_000).toISOString() }),
  ])
    assert.equal(nextAgentSession("me", [item], [booking("one")], now), undefined);
});

test("pending requests stay distinguishable from confirmed attendance", () => {
  const result = nextAgentSession(
    "me",
    [session("one")],
    [booking("one", { status: "pending" })],
    now,
  );
  assert.equal(result.booking.status, "pending");
  assert.equal(result.hosting, false);
});

test("hosts can see unfilled sessions without inventing a confirmed buddy", () => {
  const posted = session("one", { hostId: "me" });
  assert.equal(nextAgentSession("me", [posted], [], now).booking, undefined);
  assert.equal(
    nextAgentSession(
      "me",
      [posted],
      [booking("one", { hostId: "me", participantId: "other", status: "pending" })],
      now,
    ).booking,
    undefined,
  );
  assert.equal(
    nextAgentSession(
      "me",
      [posted],
      [booking("one", { hostId: "me", participantId: "other" })],
      now,
    ).booking.participantId,
    "other",
  );
});

test("the earliest valid commitment wins even when cancelled history comes first", () => {
  const sessions = [
    session("cancelled"),
    session("later", { startAt: new Date(now + 7_200_000).toISOString() }),
    session("soon"),
  ];
  const bookings = [
    booking("cancelled", { status: "cancelled" }),
    booking("later"),
    booking("soon"),
  ];
  assert.equal(nextAgentSession("me", sessions, bookings, now).session.id, "soon");
});
