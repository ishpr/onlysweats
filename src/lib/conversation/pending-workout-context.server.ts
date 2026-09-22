import type { Sql } from "../db.ts";
import type { ChatMessage } from "../../../shared/conversation.ts";
import { latestWorkoutDraftAction, type PendingWorkoutRecall } from "./context.ts";
import { commandInput } from "./agent-tools.server.ts";
import { workoutPlanDraftInput } from "./plan-draft.ts";

/** Read only the exact latest pending suggestion; never parse presentation facts or saved records. */
export async function readPendingWorkoutRecall(
  sql: Sql,
  userId: string,
  history: ChatMessage[],
  input: { requestId: string; consentGeneration: string; historyGeneration: string },
  now: number,
): Promise<PendingWorkoutRecall | null> {
  const latest = latestWorkoutDraftAction(history, input.requestId);
  if (!latest || latest.action.kind !== "agent_card") return null;
  const [row] = await sql<{ command: unknown }>`select a.command from assistant_chat_actions a
    join assistant_chat_settings s on s.user_id = a.user_id
    join assistant_chat_messages m on m.id = a.message_id and m.user_id = a.user_id
    join profiles p on p.id = a.user_id
    where a.id = ${latest.action.id} and a.message_id = ${latest.message.id}
      and a.user_id = ${userId} and a.receipt is null and not a.executing
      and a.expires_at > ${new Date(now).toISOString()}
      and a.consent_generation = ${input.consentGeneration}
      and a.history_generation = ${input.historyGeneration}
      and s.consent_generation = a.consent_generation and s.history_generation = a.history_generation
      and s.cloud_enabled and p.deleted_at is null and p.suspended_at is null
      and m.role = 'assistant' and m.status = 'complete'`;
  if (!row) return null;
  let raw = row.command;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = commandInput.safeParse(raw);
  if (!parsed.success || parsed.data.kind !== "save_workout") return null;
  const { plan } = parsed.data;
  // Current model drafts have uniform targets per exercise. Refuse to flatten
  // any future richer prescription, add load, or mistake saved actuals for a draft.
  for (const exercise of plan.exercises) {
    const first = exercise.sets[0];
    if (
      exercise.sets.some(
        (set) =>
          set.weight !== null ||
          set.distanceMeters !== null ||
          set.unit !== "bodyweight" ||
          set.reps !== first.reps ||
          set.durationSeconds !== first.durationSeconds ||
          set.restSeconds !== first.restSeconds,
      )
    )
      return null;
  }
  const draft = workoutPlanDraftInput.safeParse({
    title: plan.title,
    activity: plan.activity,
    instructions: plan.instructions,
    exercises: plan.exercises.map((exercise) => ({
      name: exercise.name,
      instructions: exercise.instructions,
      sets: exercise.sets.length,
      reps: exercise.sets[0].reps,
      durationSeconds: exercise.sets[0].durationSeconds,
      restSeconds: exercise.sets[0].restSeconds,
    })),
  });
  return draft.success
    ? { actionId: latest.action.id, messageId: latest.message.id, draft: draft.data }
    : null;
}
