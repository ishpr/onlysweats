import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { makeDb } from "../pace/test-db.ts";
import { pair } from "../agents/test-helpers.ts";
import * as pace from "../pace/service.server.ts";
import * as blocks from "../pace/training-blocks.server.ts";
import { assertMembershipEntitled } from "./service.server.ts";

test("membership gate protects new commitments while preserving existing attendance and withdrawals", async () => {
  const keys = [
    "BILLING_ENABLED",
    "BILLING_CLUSTER_READY",
    "BILLING_ENFORCED",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_MEMBERSHIP_PRICE_ID",
    "STRIPE_PORTAL_CONFIGURATION_ID",
    "BILLING_RETURN_URL",
  ];
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const sql = await makeDb();
  try {
    process.env.BILLING_ENABLED = "false";
    const f = await pair(sql);
    const start = f.now + 86400_000;
    const input = {
      venueId: "katy",
      activity: "run" as const,
      title: "Membership gate fixture",
      detail: "",
      ability: { kind: "run" as const, paceMinSec: 570, paceMaxSec: 600, miles: 1 },
      abilityFlex: "strict" as const,
      startAt: new Date(start).toISOString(),
      durationMin: 30,
      capacity: 3,
      visibility: "public" as const,
      joinMode: "instant" as const,
      womenOnly: false,
    };
    const existing = await pace.postSession(sql, f.host, input);
    const booked = await pace.bookSeat(sql, f.member, existing.id);
    const unjoined = await pace.postSession(sql, f.host, {
      ...input,
      startAt: new Date(start + 3600_000).toISOString(),
    });
    const standing = await pace.repeatWeekly(sql, f.host, f.booking.id, f.now);
    await sql`update profiles set completed_count = 2 where id in (${f.host}, ${f.member})`;
    Object.assign(process.env, {
      BILLING_ENABLED: "true",
      BILLING_CLUSTER_READY: "true",
      BILLING_ENFORCED: "true",
      STRIPE_SECRET_KEY: "sk_test_synthetic_fixture_only",
      STRIPE_WEBHOOK_SECRET: "whsec_synthetic_fixture_only",
      STRIPE_MEMBERSHIP_PRICE_ID: "price_synthetic",
      STRIPE_PORTAL_CONFIGURATION_ID: "bpc_synthetic",
      BILLING_RETURN_URL: "https://samepace.example/billing-return",
    });
    await assert.rejects(pace.bookSeat(sql, f.member, unjoined.id), /active membership/);
    await assert.rejects(
      pace.postSession(sql, f.host, {
        ...input,
        startAt: new Date(start + 3600_000).toISOString(),
      }),
      /active membership/,
    );
    await assert.rejects(
      blocks.postTrainingBlock(sql, f.host, {
        activity: "run",
        goalKind: "consistency",
        goalDate: new Date(start + 42 * 86400_000).toISOString().slice(0, 10),
        capacity: 2,
        visibility: "public",
        joinMode: "instant",
        womenOnly: false,
        slots: [{ ...input, startAt: new Date(start + 7200_000).toISOString() }],
      }),
      /active membership/,
    );
    // The gate never prevents keeping or withdrawing an existing commitment.
    await pace.checkInGeo(sql, f.host, booked.id, { lat: 32.8019, lng: -96.8074 }, start);
    await pace.checkInGeo(sql, f.member, booked.id, { lat: 32.8019, lng: -96.8074 }, start);
    assert.equal((await pace.getBooking(sql, f.member, booked.id)).status, "completed");
    const afterNext = f.now + 8 * 86400_000;
    assert.equal(
      await sql.transaction((tx) => pace.ensureNextOccurrence(tx, standing.id, afterNext)),
      null,
    );
    const notices = await sql`select id from notifications where kind = 'standing_slot_membership'`;
    assert.equal(notices.length, 1);
    await sql.transaction((tx) => pace.ensureNextOccurrence(tx, standing.id, afterNext));
    assert.equal(
      (await sql`select id from notifications where kind = 'standing_slot_membership'`).length,
      1,
    );
    // Server-reconciled active membership resumes eligibility, stale state does not.
    for (const member of [f.host, f.member])
      await sql`insert into billing_accounts
      (id, profile_id, livemode, membership_status, period_end, reconciled_at)
      values (${randomUUID()}, ${member}, false, 'active', ${new Date(afterNext + 30 * 86400_000)}, ${new Date(afterNext)})`;
    await assertMembershipEntitled(sql, f.host, afterNext);
    assert.ok(await sql.transaction((tx) => pace.ensureNextOccurrence(tx, standing.id, afterNext)));
    await assert.rejects(
      assertMembershipEntitled(sql, f.host, afterNext + 2 * 86400_000),
      /active membership/,
    );
    await pace.leaveSeries(sql, f.member, standing.id, afterNext);
    process.env.BILLING_CLUSTER_READY = "false";
    await assertMembershipEntitled(sql, f.host, afterNext + 2 * 86400_000);
  } finally {
    for (const key of keys)
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
  }
});
