import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { Sql } from "../db.ts";
import { ensureProfile } from "./service.server.ts";
import { makeDb } from "./test-db.ts";
import * as intents from "./persona-creation-intents.server.ts";

let sql: Sql;
let sequence = 0;
const now = Date.UTC(2026, 8, 22);
before(async () => {
  sql = await makeDb();
});
async function prepare(environment: intents.PersonaEnvironment = "sandbox") {
  const profileId = `intent_user_${++sequence}`;
  const email = `${profileId}@example.com`;
  await sql`insert into "user" (id,name,email,"emailVerified") values (${profileId},'Intent',${email},true)`;
  await ensureProfile(sql, { id: profileId, name: "Intent", email });
  const input = {
    profileId,
    tier: "member" as const,
    templateId: "itmpl_member",
    environment,
    bindingVersion: 1 as const,
  };
  const row = await intents.preparePersonaCreationIntent(sql, input, now);
  return { input, row };
}
async function get(id: string) {
  return (
    await sql<intents.CreationIntent>`select * from persona_creation_intents where id = ${id}`
  )[0];
}
async function deleteOwner(id: string, time = now + 1) {
  await sql.transaction(async (tx) => {
    await tx`select id from profiles where id = ${id} for update`;
    await intents.cancelPersonaCreationIntents(tx, id, time);
    await tx`update profiles set deleted_at = ${new Date(time).toISOString()} where id = ${id}`;
  });
}

describe("durable Persona creation intents", () => {
  it("commits opaque immutable requests and reuses only the same live binding", async () => {
    const { input, row } = await prepare();
    const again = await intents.preparePersonaCreationIntent(sql, input, now + 1);
    assert.equal(again.id, row.id);
    assert.equal(again.idempotency_key, row.idempotency_key);
    assert.ok(!row.idempotency_key.includes(input.profileId));
    assert.equal((await get(row.id)).first_dispatched_at, null);
    await assert.rejects(
      intents.preparePersonaCreationIntent(sql, { ...input, templateId: "itmpl_changed" }, now),
    );
    await assert.rejects(
      intents.preparePersonaCreationIntent(sql, { ...input, environment: "production" }, now),
    );
    let checked = false;
    await assert.rejects(
      intents.preparePersonaCreationIntent(sql, input, now, async () => {
        checked = true;
        throw new Error("Another request already bound a check");
      }),
    );
    assert.equal(checked, true);
    assert.equal((await get(row.id)).id, row.id);
  });

  it("leases once and fences stale completion and failure after recovery", async () => {
    const { row } = await prepare();
    assert.equal(await intents.claimPersonaCreationIntent(sql, row.id, "production", now), null);
    const first = (await intents.claimPersonaCreationIntent(sql, row.id, "sandbox", now))!;
    assert.ok(first.leaseToken);
    assert.equal(await intents.claimPersonaCreationIntent(sql, row.id, "sandbox", now + 1), null);
    const time = now + intents.PERSONA_CREATE_LEASE_MS + 1;
    const second = (await intents.claimPersonaCreationIntent(sql, row.id, "sandbox", time))!;
    assert.notEqual(second.leaseToken, first.leaseToken);
    await intents.failPersonaCreationIntent(sql, first, time);
    assert.equal((await get(row.id)).lease_token, second.leaseToken);
    const stale = await intents.completePersonaCreationIntent(
      sql,
      first,
      { providerRef: "inq_stale", valid: true },
      time,
      async () => {
        throw new Error("must not bind");
      },
    );
    assert.equal(stale.outcome, "stale");
    const done = await intents.completePersonaCreationIntent(
      sql,
      second,
      { providerRef: "inq_claimed", valid: true },
      time,
      async (_tx, intent) => intent.profile_id,
    );
    assert.equal(done.outcome, "bound");
    assert.equal(done.value, row.profile_id);
    assert.equal(await get(row.id), undefined);
  });

  it("retains the known inquiry when local binding rolls back", async () => {
    const { row, input } = await prepare();
    const claim = (await intents.claimPersonaCreationIntent(sql, row.id, "sandbox", now))!;
    await assert.rejects(
      intents.completePersonaCreationIntent(
        sql,
        claim,
        { providerRef: "inq_binding_rollback", valid: true },
        now + 1,
        async (tx) => {
          await tx`update profiles set name = 'Should roll back' where id = ${input.profileId}`;
          throw new Error("Synthetic database rollback");
        },
      ),
    );
    assert.equal((await get(row.id)).provider_ref, "inq_binding_rollback");
    assert.equal(
      (await sql<{ name: string }>`select name from profiles where id = ${input.profileId}`)[0]
        .name,
      "Intent",
    );
    await intents.failPersonaCreationIntent(sql, claim, now + 2);
    const recovered = await intents.claimPersonaCreationIntent(
      sql,
      row.id,
      "sandbox",
      now + intents.PERSONA_CREATE_REPLAY_MS + 1,
    );
    assert.equal(
      recovered?.provider_ref,
      "inq_binding_rollback",
      "known IDs remain recoverable without replaying create",
    );
    await deleteOwner(input.profileId, now + intents.PERSONA_CREATE_REPLAY_MS + 2);
    assert.equal(await get(row.id), undefined);
    assert.equal(
      (
        await sql`select provider_ref from persona_redaction_jobs where provider_ref = 'inq_binding_rollback'`
      ).length,
      1,
    );
  });

  it("scrubs deleted owners while retaining unresolved creates and cleans late success", async () => {
    const { input, row } = await prepare();
    const claim = (await intents.claimPersonaCreationIntent(sql, row.id, "sandbox", now))!;
    await deleteOwner(input.profileId);
    const pending = await get(row.id);
    assert.equal(pending.profile_id, null);
    assert.equal(pending.tier, null);
    assert.equal(pending.cancel_requested, true);
    assert.equal(pending.idempotency_key, row.idempotency_key);
    const done = await intents.completePersonaCreationIntent(
      sql,
      claim,
      { providerRef: "inq_deleted_late", valid: true },
      now + 2,
      async () => {
        throw new Error("must not bind deleted owner");
      },
    );
    assert.equal(done.outcome, "redaction_queued");
    assert.equal(await get(row.id), undefined);
    const [job] = await sql<{
      provider_environment: string;
    }>`select * from persona_redaction_jobs where provider_ref = 'inq_deleted_late'`;
    assert.equal(job.provider_environment, "sandbox");
  });

  it("discards never-dispatched deletion and refuses expired unknown replay", async () => {
    const unsent = await prepare();
    await deleteOwner(unsent.input.profileId);
    assert.equal(await get(unsent.row.id), undefined);
    const sent = await prepare();
    await intents.claimPersonaCreationIntent(sql, sent.row.id, "sandbox", now);
    await deleteOwner(sent.input.profileId);
    assert.equal(
      await intents.claimPersonaCreationIntent(
        sql,
        sent.row.id,
        "sandbox",
        now + intents.PERSONA_CREATE_REPLAY_MS,
      ),
      null,
    );
    const retained = await get(sent.row.id);
    assert.equal(retained.state, "review_required");
    assert.equal(retained.review_reason, "replay_expired");
    assert.equal(retained.profile_id, null);
    assert.ok(
      !(
        await intents.listDuePersonaCreationIntents(
          sql,
          "sandbox",
          now + 2 * intents.PERSONA_CREATE_REPLAY_MS,
        )
      ).includes(sent.row.id),
    );
  });

  it("queues invalid responses and retains unexpected Account review after deletion", async () => {
    const invalid = await prepare();
    const invalidClaim = (await intents.claimPersonaCreationIntent(
      sql,
      invalid.row.id,
      "sandbox",
      now,
    ))!;
    assert.equal(
      (
        await intents.completePersonaCreationIntent(
          sql,
          invalidClaim,
          { providerRef: "inq_invalid", valid: false },
          now + 1,
        )
      ).outcome,
      "redaction_queued",
    );
    const account = await prepare();
    const claim = (await intents.claimPersonaCreationIntent(sql, account.row.id, "sandbox", now))!;
    const result = await intents.completePersonaCreationIntent(
      sql,
      claim,
      {
        providerRef: "inq_account",
        valid: false,
        accountDetected: true,
        accountRef: "act_unexpected",
      },
      now + 1,
    );
    assert.equal(result.outcome, "review_required");
    await deleteOwner(account.input.profileId, now + 2);
    const review = await get(account.row.id);
    assert.equal(review.profile_id, null);
    assert.equal(review.tier, null);
    assert.equal(review.provider_account_ref, "act_unexpected");
    assert.equal(review.review_reason, "account_detected");
  });

  it("retains Account evidence discovered after binding without member data", async () => {
    const input = {
      providerRef: "inq_later_account",
      templateId: "itmpl_member",
      environment: "sandbox" as const,
      accountRef: "act_later",
    };
    await sql.transaction((tx) => intents.recordPersonaAccountReview(tx, input, now));
    await sql.transaction((tx) => intents.recordPersonaAccountReview(tx, input, now + 1));
    const rows =
      await sql<intents.CreationIntent>`select * from persona_creation_intents where provider_ref = ${input.providerRef}`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "review_required");
    assert.equal(rows[0].profile_id, null);
    assert.equal(rows[0].provider_account_ref, input.accountRef);
    await assert.rejects(
      sql.transaction((tx) =>
        intents.recordPersonaAccountReview(tx, { ...input, environment: "production" }, now + 2),
      ),
    );
  });

  it("preserves both cleanup obligations when a replay returns a different inquiry", async () => {
    const { row } = await prepare();
    const claim = (await intents.claimPersonaCreationIntent(sql, row.id, "sandbox", now))!;
    await assert.rejects(
      intents.completePersonaCreationIntent(
        sql,
        claim,
        { providerRef: "inq_original_result", valid: true },
        now,
        async () => {
          throw new Error("binding failed");
        },
      ),
    );
    const result = await intents.completePersonaCreationIntent(
      sql,
      claim,
      { providerRef: "inq_inconsistent_result", valid: false },
      now + 1,
    );
    assert.equal(result.outcome, "review_required");
    assert.equal((await get(row.id)).review_reason, "inconsistent_inquiry");
    const jobs = await sql`select provider_ref from persona_redaction_jobs
      where provider_ref in ('inq_original_result', 'inq_inconsistent_result')`;
    assert.equal(jobs.length, 2);
  });

  it("lists due work only for the matching environment and retry deadline", async () => {
    const sandbox = await prepare();
    const production = await prepare("production");
    const claim = (await intents.claimPersonaCreationIntent(sql, sandbox.row.id, "sandbox", now))!;
    await intents.failPersonaCreationIntent(sql, claim, now);
    assert.ok(
      !(await intents.listDuePersonaCreationIntents(sql, "sandbox", now)).includes(sandbox.row.id),
    );
    assert.ok(
      (await intents.listDuePersonaCreationIntents(sql, "sandbox", now + 5_001, 20)).includes(
        sandbox.row.id,
      ),
    );
    const due = await intents.listDuePersonaCreationIntents(sql, "production", now, 20);
    assert.ok(due.includes(production.row.id));
    assert.ok(!due.includes(sandbox.row.id));
  });
});
