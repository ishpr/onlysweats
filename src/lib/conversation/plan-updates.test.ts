import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { Sql } from "../db.ts";
import { makeDb, pair, proposal, HOUR } from "../agents/test-helpers.ts";
import * as agents from "../agents/service.server.ts";
import * as assistant from "../agents/assistant.server.ts";
import { fixtureMember } from "../workout-plans/fixtures.ts";
import { APP_TERMS_VERSION } from "../../../shared/app-terms.ts";
import { CHAT_NOTICE_VERSION } from "../../../shared/conversation.ts";
import { isAgentChatCard } from "../../../shared/agent-cards.ts";
import { acceptAppTerms, getHistory, clearHistory, setSettings } from "./service.server.ts";
import { executeChatAction } from "./actions.server.ts";
import { syncAgentPlanUpdates } from "./plan-updates.server.ts";

let sql: Sql;
const previousA2A = process.env.A2A_ENABLED;
before(async () => {
  sql = await makeDb();
  process.env.A2A_ENABLED = "true";
});
after(() => {
  if (previousA2A === undefined) delete process.env.A2A_ENABLED;
  else process.env.A2A_ENABLED = previousA2A;
});
const iso = (now: number) => new Date(now).toISOString();
function preferences(now: number) {
  const p = proposal(now).plan;
  return {
    enabled: true,
    activity: p.activity,
    ability: p.ability,
    durationMin: p.durationMin,
    venueIds: [p.venueId],
    approvedIntent: "Synthetic shared plan",
    availability: [{ startAt: p.startAt, endAt: iso(+new Date(p.startAt) + HOUR) }],
  };
}
async function fixture() {
  const value = await pair(sql);
  for (const id of [value.host, value.member]) {
    await acceptAppTerms(sql, id, { version: APP_TERMS_VERSION }, value.now);
    await assistant.setPreferences(sql, id, preferences(value.now), value.now);
  }
  return value;
}
async function propose(value: Awaited<ReturnType<typeof fixture>>) {
  return agents.propose(
    sql,
    {
      id: value.hostGrant.id,
      profileId: value.host,
      label: value.hostGrant.label,
    },
    value.room.id,
    randomUUID(),
    proposal(value.now),
    value.now + 1,
  );
}
async function messages(id: string, now: number) {
  return (await getHistory(sql, id, now)).messages;
}

describe("bounded shared-plan updates in private chat", () => {
  it("baselines empty rooms quietly, then creates one actionable update across concurrent polls", async () => {
    const value = await fixture();
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now), { added: 0 });
    assert.deepEqual(await messages(value.host, value.now), []);
    assert.equal(
      (await sql`select 1 from assistant_plan_updates where user_id=${value.host}`).length,
      1,
    );
    await propose(value);
    const polls = await Promise.all([
      syncAgentPlanUpdates(sql, value.host, value.now + 2, "America/Chicago"),
      syncAgentPlanUpdates(sql, value.host, value.now + 2, "America/Chicago"),
    ]);
    assert.equal(
      polls.reduce((n, value) => n + value.added, 0),
      1,
    );
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 3), { added: 0 });
    const history = await getHistory(sql, value.host, value.now + 4);
    assert.equal(history.messages.length, 1);
    const action = history.messages[0].actions[0];
    assert.equal(action.card?.primaryLabel, "Approve this plan");
    assert.ok(isAgentChatCard(action.card));
    assert.equal((await sql`select 1 from assistant_chat_actions where id=${action.id}`).length, 1);
    const room = await agents.getNegotiation(sql, value.host, value.room.id);
    assert.deepEqual(room.confirmations, []);
    assert.equal(room.result_booking_id, null);
    assert.equal(
      (await sql`select count(*)::int n from sessions where host_id=${value.host}`)[0].n,
      1,
    );
    await executeChatAction(
      sql,
      value.host,
      action.id,
      {
        consentGeneration: history.settings.consentGeneration,
        historyGeneration: history.settings.historyGeneration,
      },
      value.now + 5,
    );
    assert.deepEqual((await agents.getNegotiation(sql, value.host, value.room.id)).confirmations, [
      value.host,
    ]);
    assert.equal(
      (await agents.getNegotiation(sql, value.host, value.room.id)).result_booking_id,
      null,
    );
  });

  it("adds partner approval and truthful read-only booked updates, never creating a booking during polling", async () => {
    const value = await fixture();
    const room = await propose(value);
    await syncAgentPlanUpdates(sql, value.host, value.now + 2);
    await agents.confirmProposal(sql, value.member, room.id, room.revision, value.now + 3);
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 4), { added: 1 });
    assert.match((await messages(value.host, value.now + 4)).at(-1)!.text, /partner approved/);
    assert.equal((await agents.getNegotiation(sql, value.host, room.id)).result_booking_id, null);
    await agents.confirmProposal(sql, value.host, room.id, room.revision, value.now + 5);
    const review = await assistant.getBookingTerms(sql, value.host, room.id, value.now + 6);
    const body = { revision: review.terms.revision, termsHash: review.terms.termsHash };
    await assistant.approveBookingTerms(sql, value.member, room.id, body, value.now + 7);
    await syncAgentPlanUpdates(sql, value.host, value.now + 8);
    assert.match(
      (await messages(value.host, value.now + 8)).at(-1)!.text,
      /partner accepted the booking terms/,
    );
    assert.equal((await agents.getNegotiation(sql, value.host, room.id)).result_booking_id, null);
    await assistant.approveBookingTerms(sql, value.host, room.id, body, value.now + 9);
    const before = (await sql`select count(*)::int n from sessions where host_id=${value.host}`)[0]
      .n;
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 10), { added: 1 });
    const last = (await messages(value.host, value.now + 10)).at(-1)!;
    assert.match(last.text, /workout is booked/);
    assert.equal(last.actions[0].card?.primaryLabel, null);
    assert.equal(
      (await sql`select 1 from assistant_chat_actions where id=${last.actions[0].id}`).length,
      0,
    );
    assert.equal(
      (await sql`select count(*)::int n from sessions where host_id=${value.host}`)[0].n,
      before,
    );
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 11), { added: 0 });
  });

  it("isolates owners and checks block, grants, active leases, settings and Terms before appending", async () => {
    const value = await fixture();
    await propose(value);
    const stranger = await fixtureMember(sql);
    await acceptAppTerms(sql, stranger, { version: APP_TERMS_VERSION }, value.now);
    assert.deepEqual(await syncAgentPlanUpdates(sql, stranger, value.now + 2), { added: 0 });
    await sql`insert into blocks(blocker_id,blocked_id) values(${value.member},${value.host})`;
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 2), { added: 0 });
    await sql`delete from blocks where blocker_id=${value.member} and blocked_id=${value.host}`;
    await agents.revokeDelegation(sql, value.host, value.hostGrant.id, value.now + 3);
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 4), { added: 0 });
    await agents.createDelegation(
      sql,
      value.host,
      { label: "Synthetic replacement", expiresInHours: 1 },
      value.now + 5,
    );
    await sql`update assistant_chat_settings set active_request_id=${randomUUID()},lease_until=${iso(value.now + HOUR)} where user_id=${value.host}`;
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 6), { added: 0 });
    await sql`update assistant_chat_settings set active_request_id=null,lease_until=null where user_id=${value.host}`;
    await sql`delete from app_terms_acceptances where user_id=${value.host}`;
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 7), { added: 0 });
    await acceptAppTerms(sql, value.host, { version: APP_TERMS_VERSION }, value.now + 8);
    await setSettings(
      sql,
      value.host,
      { cloudEnabled: false, fitnessContextEnabled: false, noticeVersion: CHAT_NOTICE_VERSION },
      value.now + 9,
    );
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 10), { added: 0 });
    assert.deepEqual(await messages(value.host, value.now + 10), []);
    assert.equal(
      (await sql`select 1 from assistant_plan_updates where user_id=${value.host}`).length,
      0,
    );
  });

  it("does not append expired or paused-account plans; a new history generation gets one fresh review", async () => {
    const value = await fixture();
    await propose(value);
    await sql`update profiles set suspended_at=${iso(value.now)} where id=${value.member}`;
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 2), { added: 0 });
    await sql`update profiles set suspended_at=null where id=${value.member}`;
    await sql`update agent_negotiations set expires_at=${iso(value.now + 2)} where id=${value.room.id}`;
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 3), { added: 0 });
    await sql`update agent_negotiations set expires_at=${iso(value.now + HOUR)} where id=${value.room.id}`;
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 4), { added: 1 });
    await clearHistory(sql, value.host, value.now + 5);
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 6), { added: 1 });
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 7), { added: 0 });
    assert.equal((await messages(value.host, value.now + 7)).length, 1);
    assert.equal(
      (await sql`select 1 from assistant_plan_updates where user_id=${value.host}`).length,
      1,
    );
  });

  it("automatic rooms need current authority and Terms from both members even without API delegations", async () => {
    const value = await fixture();
    await propose(value);
    await sql`update agent_negotiations set
      host_contact_revision=(select revision from agent_contact_authorities where profile_id=${value.host}),
      participant_contact_revision=(select revision from agent_contact_authorities where profile_id=${value.member})
      where id=${value.room.id}`;
    await agents.revokeDelegation(sql, value.host, value.hostGrant.id, value.now + 2);
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 3), { added: 1 });
    await clearHistory(sql, value.host, value.now + 4);
    await sql`delete from app_terms_acceptances where user_id=${value.member}`;
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 5), { added: 0 });
    assert.deepEqual(await messages(value.host, value.now + 5), []);
    await acceptAppTerms(sql, value.member, { version: APP_TERMS_VERSION }, value.now + 6);
    await sql`update agent_contact_authorities set enabled=false where profile_id=${value.member}`;
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 7), { added: 0 });
    assert.deepEqual(await messages(value.host, value.now + 7), []);
  });

  it("changed terms invalidate the old partner approval in both update text and review card", async () => {
    const value = await fixture();
    const room = await propose(value);
    await agents.confirmProposal(sql, value.host, room.id, room.revision, value.now + 2);
    await agents.confirmProposal(sql, value.member, room.id, room.revision, value.now + 3);
    const before = await assistant.getBookingTerms(sql, value.member, room.id, value.now + 4);
    await assistant.approveBookingTerms(
      sql,
      value.member,
      room.id,
      {
        revision: before.terms.revision,
        termsHash: before.terms.termsHash,
      },
      value.now + 5,
    );
    await syncAgentPlanUpdates(sql, value.host, value.now + 6);
    assert.match((await messages(value.host, value.now + 6)).at(-1)!.text, /partner accepted/);
    await assistant.setPreferences(
      sql,
      value.host,
      {
        ...preferences(value.now),
        approvedIntent: "Updated synthetic member intention",
      },
      value.now + 7,
    );
    assert.deepEqual(await syncAgentPlanUpdates(sql, value.host, value.now + 8), { added: 1 });
    const last = (await messages(value.host, value.now + 8)).at(-1)!;
    assert.doesNotMatch(last.text, /partner accepted/);
    assert.match(last.text, /Review the booking terms/);
    assert.equal(last.actions[0].card?.primaryLabel, "Accept booking terms");
    const command = (
      await sql<{
        command: { termsHash: string };
      }>`select command from assistant_chat_actions where id=${last.actions[0].id}`
    )[0].command;
    assert.notEqual(command.termsHash, before.terms.termsHash);
    assert.equal((await agents.getNegotiation(sql, value.host, room.id)).result_booking_id, null);
  });

  it("inspects at most ten recent owned rooms and emits at most three changed plans per poll", async () => {
    const now = Date.now();
    const owner = await fixtureMember(sql);
    await acceptAppTerms(sql, owner, { version: APP_TERMS_VERSION }, now);
    await assistant.setPreferences(sql, owner, preferences(now), now);
    await agents.createDelegation(
      sql,
      owner,
      { label: "Synthetic bounded watcher", expiresInHours: 1 },
      now,
    );
    for (let i = 0; i < 11; i++) {
      const partner = await fixtureMember(sql);
      await assistant.setPreferences(sql, partner, preferences(now), now);
      await sql`insert into agent_negotiations(id,booking_id,host_id,participant_id,host_consented,participant_consented,plan,revision,expires_at,updated_at)
        values(${randomUUID()},null,${owner},${partner},true,true,${JSON.stringify(proposal(now).plan)}::jsonb,1,${iso(now + HOUR)},${iso(now + i)})`;
    }
    const observed = [];
    for (let i = 0; i < 4; i++)
      observed.push((await syncAgentPlanUpdates(sql, owner, now + 100 + i)).added);
    assert.deepEqual(observed, [3, 3, 3, 1]);
    assert.deepEqual(await syncAgentPlanUpdates(sql, owner, now + 105), { added: 0 });
    assert.equal((await messages(owner, now + 105)).length, 10);
    assert.equal(
      (await sql`select 1 from assistant_plan_updates where user_id=${owner}`).length,
      10,
    );
    assert.equal((await sql`select 1 from sessions where host_id=${owner}`).length, 0);
  });
});
