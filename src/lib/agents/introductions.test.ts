/**
 * Meeting someone new is a public meeting: the freeze, identity verification and
 * "women only" apply to introductions even though the session they end in is
 * invite-only. Against real SQL.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { makeDb } from "../pace/test-db.ts";
import * as pace from "../pace/service.server.ts";
import * as agents from "./service.server.ts";
import * as assistant from "./assistant.server.ts";
import * as discovery from "./discovery.server.ts";

let sql: Sql;
before(async () => {
  sql = await makeDb();
});
const DAY = 86400_000;

// Members only match on a shared venue, so one venue per test keeps them apart.
async function member(
  now: number,
  venue: string,
  opts: { gender?: "woman" | "man"; womenOnly?: boolean; discoverable?: boolean } = {},
) {
  const id = randomUUID();
  await sql`insert into "user" (id, name, email, "emailVerified") values (${id}, 'Pilot member', ${`${id}@example.test`}, true)`;
  await pace.ensureProfile(sql, { id, name: "Pilot member", email: `${id}@example.test` });
  if (opts.gender) await pace.updateProfile(sql, id, { gender: opts.gender });
  const start = Math.ceil((now + DAY) / 900_000) * 900_000;
  await assistant.setPreferences(
    sql,
    id,
    {
      enabled: true,
      activity: "run",
      ability: { kind: "run", paceMinSec: 570, paceMaxSec: 600, miles: 1 },
      durationMin: 30,
      venueIds: [venue],
      approvedIntent: "",
      availability: [
        { startAt: new Date(start).toISOString(), endAt: new Date(start + 3600_000).toISOString() },
      ],
    },
    now,
  );
  if (opts.discoverable !== false) {
    await discovery.setDiscovery(
      sql,
      id,
      { enabled: true, preferenceRevision: 1, womenOnly: opts.womenOnly },
      now,
    );
  }
  return id;
}

const sees = async (viewer: string, now: number) =>
  (await discovery.getDiscovery(sql, viewer, now)).candidates.map((c) => c.memberId);
const invite = (from: string, to: string, now: number) =>
  discovery.inviteDiscovery(sql, from, { memberId: to, preferenceRevision: 1 }, now);
const freeze = (id: string, until: number | null) =>
  sql`update profiles set frozen_until = ${until === null ? null : new Date(until).toISOString()} where id = ${id}`;
const verify = (id: string, column: "verified_member_at" | "verified_id_at") =>
  sql.query(`update profiles set ${column} = now() where id = $1`, [id]);

const rejects = (p: Promise<unknown>, status: number, re: RegExp, code?: string) =>
  assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof pace.PaceError, String(err));
    assert.equal(err.status, status, err.message);
    assert.match(err.message, re);
    assert.equal(err.code, code);
    return true;
  });

describe("an introduction is a public meeting", () => {
  it("a two-strike freeze stops meeting new partners, from either side", async () => {
    const now = Date.now();
    const [a, b] = [await member(now, "katy"), await member(now, "katy")];
    assert.deepEqual(await sees(a, now), [b]);

    await freeze(b, now + 14 * DAY);
    assert.deepEqual(await sees(a, now), [], "a frozen member isn’t offered");
    const theirs = await discovery.getDiscovery(sql, b, now);
    assert.deepEqual(theirs.candidates, []);
    assert.match(theirs.reason ?? "", /paused for 14 days/);
    await rejects(invite(b, a, now), 409, /paused for 14 days/);
    // The other side isn't told why.
    await rejects(invite(a, b, now), 409, /isn’t available right now/);
    await rejects(
      discovery.setDiscovery(sql, b, { enabled: true, preferenceRevision: 1 }, now),
      409,
      /paused for 14 days/,
    );

    await freeze(b, now - 1);
    assert.deepEqual(await sees(a, now), [b], "and it lifts with the freeze");
  });

  it("is checked again at booking: a freeze can land after the invitation", async () => {
    const now = Date.now();
    const [a, b] = [await member(now, "whiterock"), await member(now, "whiterock")];
    const room = await invite(a, b, now);
    await agents.consentToNegotiation(sql, b, room.id, true, now);
    const [plan] = (await assistant.suggestPlans(sql, a, room.id, now)).candidates;
    await agents.proposeForMember(
      sql,
      a,
      room.id,
      { messageId: randomUUID(), expectedRevision: 0, plan },
      now,
    );
    await agents.confirmProposal(sql, a, room.id, 1, now);
    await agents.confirmProposal(sql, b, room.id, 1, now);
    const { terms } = await assistant.getBookingTerms(sql, a, room.id, now);
    const approve = (who: string) =>
      assistant.approveBookingTerms(
        sql,
        who,
        room.id,
        { revision: 1, termsHash: terms.termsHash },
        now,
      );

    await freeze(a, now + 14 * DAY);
    await rejects(approve(a), 409, /paused for 14 days/);
    await rejects(approve(b), 409, /isn’t available right now/);
    const [{ n }] = await sql<{ n: number }>`
      select count(*)::int n from sessions where host_id in (${a}, ${b})`;
    assert.equal(n, 0, "the invite-only session was never posted");

    await freeze(a, null);
    await approve(a);
    assert.equal((await approve(b)).booked, true);
  });

  describe("with verification enforced", () => {
    before(() => {
      process.env.VERIFICATION_ENFORCED = "1";
    });
    after(() => {
      delete process.env.VERIFICATION_ENFORCED;
    });

    it("takes a verified phone and face, and says which check is missing", async () => {
      delete process.env.VERIFICATION_ENFORCED;
      const now = Date.now();
      const [a, b] = [await member(now, "trinity"), await member(now, "trinity")];
      process.env.VERIFICATION_ENFORCED = "1";
      await verify(a, "verified_member_at");

      assert.deepEqual(await sees(a, now), [], "an unverified member isn’t offered");
      const theirs = await discovery.getDiscovery(sql, b, now);
      assert.equal(theirs.needs, "verify_member");
      assert.match(theirs.reason ?? "", /phone and face/);
      await rejects(invite(b, a, now), 403, /phone and face/, "verify_member");
      await rejects(invite(a, b, now), 409, /isn’t available right now/);

      await verify(b, "verified_member_at");
      assert.deepEqual(await sees(a, now), [b]);
      assert.equal((await invite(a, b, now)).booking_id, null);
    });

    it("women only takes a government ID, from whoever chooses it and whoever meets them", async () => {
      delete process.env.VERIFICATION_ENFORCED;
      const now = Date.now();
      const choosy = await member(now, "turtle", { gender: "woman", womenOnly: true });
      const other = await member(now, "turtle", { gender: "woman" });
      process.env.VERIFICATION_ENFORCED = "1";
      for (const id of [choosy, other]) await verify(id, "verified_member_at");

      assert.equal((await discovery.getDiscovery(sql, choosy, now)).needs, "verify_government_id");
      await verify(choosy, "verified_id_at");
      assert.deepEqual(await sees(choosy, now), [], "she isn’t offered until she has one too");
      assert.deepEqual(await sees(other, now), []);
      await verify(other, "verified_id_at");
      assert.deepEqual(await sees(choosy, now), [other]);
      assert.deepEqual(await sees(other, now), [choosy]);
    });
  });
});

describe("women only", () => {
  it("shows her only to women, and only shows her women", async () => {
    const now = Date.now();
    // A venue of their own, so the members above don't come into it.
    await sql`
      insert into venues (id, name, type, neighborhood, lat, lng, image, hint)
      values ('flagpole', 'Flag Pole Hill', 'park', 'East Dallas', 32.85, -96.72, '/venues/white-rock.jpg', 'By the pavilion.')`;
    const choosy = await member(now, "flagpole", { gender: "woman", womenOnly: true });
    const woman = await member(now, "flagpole", { gender: "woman" });
    const man = await member(now, "flagpole", { gender: "man" });
    const unsaid = await member(now, "flagpole");

    assert.deepEqual(await sees(choosy, now), [woman]);
    assert.deepEqual((await sees(woman, now)).sort(), [choosy, man, unsaid].sort());
    assert.deepEqual((await sees(man, now)).sort(), [unsaid, woman].sort());
    assert.ok(!(await sees(unsaid, now)).includes(choosy), "not saying isn’t saying woman");

    await rejects(invite(man, choosy, now), 404, /no longer available/);
    await rejects(invite(choosy, man, now), 404, /no longer available/);
    assert.equal((await invite(woman, choosy, now)).booking_id, null);

    const hers = await discovery.getDiscovery(sql, choosy, now);
    assert.equal(hers.womenOnly, true);
    assert.equal(hers.canChooseWomenOnly, true);
    const his = await discovery.getDiscovery(sql, man, now);
    assert.equal(his.canChooseWomenOnly, false);
    await rejects(
      discovery.setDiscovery(
        sql,
        man,
        { enabled: true, preferenceRevision: 1, womenOnly: true },
        now,
      ),
      409,
      /chosen by women/,
    );

    // Choosing it again without the flag turns it off.
    await discovery.setDiscovery(sql, choosy, { enabled: true, preferenceRevision: 1 }, now);
    assert.ok((await sees(man, now)).includes(choosy));
  });
});
