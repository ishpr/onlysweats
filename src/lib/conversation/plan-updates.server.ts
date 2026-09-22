/** Bring authorized shared-plan changes into the private conversation without a model call. */
import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { PaceError } from "../pace/service.server.ts";
import { getNegotiation, type Negotiation } from "../agents/service.server.ts";
import { getBookingTerms } from "../agents/assistant.server.ts";
import type { AssistantBookingReview } from "../../../shared/assistant.ts";
import { APP_TERMS_VERSION } from "../../../shared/app-terms.ts";
import { CHAT_NOTICE_VERSION, type ChatAction } from "../../../shared/conversation.ts";
import { prepareAgentTool } from "./agent-tools.server.ts";
import { CHAT_ACTION_TTL_MS, storeChatActions, type PendingChatAction } from "./actions.server.ts";

const DAY = 86_400_000;
const iso = (now: number) => new Date(now).toISOString();
type SelectedRoom = { id: string; host_id: string; participant_id: string };
type Settings = {
  cloud_enabled: boolean;
  notice_version: string;
  consent_generation: string;
  history_generation: string;
  active_request_id: string | null;
  lease_until: Date | null;
};

/** Product-created rooms validate both matching revisions in getNegotiation.
 * Older rooms need an unexpired explicit delegation or room coordination grant. */
async function hasGrant(sql: Sql, userId: string, room: Negotiation, now: number) {
  if (room.host_contact_revision != null) return true;
  const rows = await sql`select 1 where
    exists(select 1 from agent_delegations d where d.profile_id=${userId}
      and d.revoked_at is null and d.expires_at>${iso(now)})
    or exists(select 1 from agent_coordination_permissions cp
      join agent_preferences p on p.profile_id=cp.profile_id
      where cp.negotiation_id=${room.id} and cp.profile_id=${userId}
        and cp.enabled and cp.expires_at>${iso(now)} and cp.preference_revision=p.revision
        and p.preferences->>'enabled'='true' and p.updated_at<=${iso(now)}
        and p.updated_at>${iso(now - 7 * DAY)})`;
  return rows.length > 0;
}
function stateHash(room: Negotiation, review: AssistantBookingReview | null) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        revision: room.revision,
        plan: room.plan,
        state: room.state,
        confirmations: [...room.confirmations].sort(),
        bookingTermsHash: review?.terms.termsHash ?? null,
        bookingApprovals: [...(review?.approvedIds ?? [])].sort(),
        resultSessionId: room.result_session_id ?? null,
        resultBookingId: room.result_booking_id ?? null,
      }),
    )
    .digest("hex");
}
function messageText(room: Negotiation, userId: string, review: AssistantBookingReview | null) {
  if (room.result_booking_id)
    return "Your workout is booked. Both people accepted the plan and booking terms.";
  const partner = room.host_id === userId ? room.participant_id : room.host_id;
  if (review?.approvedIds.includes(partner))
    return "Your partner accepted the booking terms. Review them to complete your approval.";
  if (review?.approvedIds.includes(userId))
    return "Your booking approval is saved. Waiting for your partner to accept the same terms.";
  if (room.confirmations.length === 2)
    return "You both approved the plan. Review the booking terms before a workout is booked.";
  if (room.confirmations.includes(partner))
    return "Your partner approved this plan. It is ready for your review.";
  if (room.confirmations.includes(userId))
    return "Your plan approval is saved. Your partner still needs to review it.";
  return "A shared workout plan is ready for your review. Nothing is booked yet.";
}

/** Profile locks always precede identity/settings locks. The settings lock also
 * serializes concurrent foreground polls, so a state can append only once. */
export async function syncAgentPlanUpdates(
  sql: Sql,
  userId: string,
  now = Date.now(),
  timeZone = "UTC",
): Promise<{ added: number }> {
  if (process.env.A2A_ENABLED !== "true" || !Number.isFinite(now)) return { added: 0 };
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
  } catch {
    timeZone = "UTC";
  }
  const selected =
    await sql<SelectedRoom>`select id,host_id,participant_id from agent_negotiations n
    where (host_id=${userId} or participant_id=${userId}) and updated_at>=${iso(now - 30 * DAY)}
      and host_consented and participant_consented and state<>'cancelled' and expires_at>${iso(now)}
      and (host_contact_revision is not null
        or exists(select 1 from agent_delegations d where d.profile_id=${userId}
          and d.revoked_at is null and d.expires_at>${iso(now)})
        or exists(select 1 from agent_coordination_permissions cp where cp.negotiation_id=n.id
          and cp.profile_id=${userId} and cp.enabled and cp.expires_at>${iso(now)}))
    order by updated_at desc,id limit 10`;
  if (!selected.length) return { added: 0 };
  const people = [
    ...new Set([userId, ...selected.flatMap((room) => [room.host_id, room.participant_id])]),
  ].sort();
  return sql.transaction(async (tx) => {
    await tx`select id from profiles where id=any(${people}::text[]) order by id for update`;
    const identities = await tx`select id from "user" where id=${userId} for update`;
    const [owner] =
      await tx`select id from profiles where id=${userId} and deleted_at is null and suspended_at is null`;
    const [settings] =
      await tx<Settings>`select * from assistant_chat_settings where user_id=${userId} for update`;
    if (
      !identities.length ||
      !owner ||
      !settings?.cloud_enabled ||
      settings.notice_version !== CHAT_NOTICE_VERSION
    )
      return { added: 0 };
    if (settings.active_request_id && settings.lease_until && +new Date(settings.lease_until) > now)
      return { added: 0 };
    const [accepted] =
      await tx`select 1 from app_terms_acceptances where user_id=${userId} and version=${APP_TERMS_VERSION}`;
    if (!accepted) return { added: 0 };
    await tx`delete from assistant_plan_updates where user_id=${userId} and observed_at<${iso(now - 30 * DAY)}`;
    let added = 0;
    for (const snapshot of selected) {
      let room: Negotiation;
      let review: AssistantBookingReview | null;
      try {
        room = await getNegotiation(tx, userId, snapshot.id, true, false, now);
        if (
          !people.includes(room.host_id) ||
          !people.includes(room.participant_id) ||
          room.state === "cancelled" ||
          +new Date(room.expires_at) <= now ||
          !(await hasGrant(tx, userId, room, now))
        )
          continue;
        review = room.plan ? await getBookingTerms(tx, userId, room.id, now) : null;
      } catch (error) {
        if (error instanceof PaceError && [403, 404, 409].includes(error.status)) continue;
        throw error;
      }
      const hash = stateHash(room, review);
      const [previous] = await tx<{
        state_hash: string;
        consent_generation: string;
        history_generation: string;
      }>`
        select state_hash,consent_generation,history_generation from assistant_plan_updates
        where user_id=${userId} and negotiation_id=${room.id}`;
      if (
        previous?.state_hash === hash &&
        previous.consent_generation === settings.consent_generation &&
        previous.history_generation === settings.history_generation
      )
        continue;
      if (room.plan) {
        if (added >= 3) continue;
        let drafts;
        try {
          ({ drafts } = await prepareAgentTool(
            tx,
            userId,
            "reviewPlan",
            { negotiationId: room.id },
            {
              now,
              timeZone,
              readManualWorkouts: async () => {
                throw new Error("Plan updates must not read workout history");
              },
              readWorkoutSummaries: async () => {
                throw new Error("Plan updates must not read health history");
              },
            },
          ));
        } catch (error) {
          if (error instanceof PaceError && [403, 404, 409].includes(error.status)) continue;
          throw error;
        }
        const messageId = randomUUID();
        const pending: PendingChatAction[] = drafts.map((draft) => ({
          ...draft,
          id: randomUUID(),
          card: {
            ...draft.card,
            expiresAt: iso(Math.min(now + CHAT_ACTION_TTL_MS, +new Date(room.expires_at))),
          },
        }));
        const actions: ChatAction[] = pending.map((draft) => ({
          id: draft.id,
          kind: "agent_card",
          label: draft.label,
          description: draft.description,
          card: draft.card,
        }));
        await tx`insert into assistant_chat_messages(id,user_id,request_id,role,text,actions,status,created_at)
          values(${messageId},${userId},${randomUUID()},'assistant',${messageText(room, userId, review)},
            ${JSON.stringify(actions)}::jsonb,'complete',${iso(now + added)})`;
        await storeChatActions(
          tx,
          userId,
          messageId,
          {
            consentGeneration: settings.consent_generation,
            historyGeneration: settings.history_generation,
          },
          pending,
          now,
        );
        added++;
      }
      // Empty rooms establish a quiet baseline. Do not fabricate a pending plan.
      await tx`insert into assistant_plan_updates(user_id,negotiation_id,consent_generation,history_generation,state_hash,observed_at)
        values(${userId},${room.id},${settings.consent_generation},${settings.history_generation},${hash},${iso(now)})
        on conflict(user_id,negotiation_id) do update set consent_generation=excluded.consent_generation,
          history_generation=excluded.history_generation,state_hash=excluded.state_hash,observed_at=excluded.observed_at`;
    }
    return { added };
  });
}
