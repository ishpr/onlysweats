/** Models prepare review cards. Only an authenticated member tap executes a stored command. */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.ts";
import type { AgentChatCard } from "../../../shared/agent-cards.ts";
import * as pace from "../pace/service.server.ts";
import {
  abilityLabel,
  validAbility,
  LATE_CANCEL_MS,
  LATE_CANCEL_FEE_CENTS,
  NO_SHOW_FEE_CENTS,
  MIN_LEAD_TIME_MS,
} from "../pace/rules.ts";
import * as assistant from "../agents/assistant.server.ts";
import * as agents from "../agents/service.server.ts";
import * as discovery from "../agents/discovery.server.ts";
import * as contacts from "../agents/contact.server.ts";
import { activity, workoutPlan } from "../agents/contracts.ts";
import * as workouts from "../workout-plans/service.server.ts";
import {
  createPlanInput,
  updateRunInput,
  workoutSetResultInput,
} from "../workout-plans/contracts.ts";
import {
  goalInput,
  getPrivateGoal,
  savePrivateGoal,
  validateGoalDate,
} from "./private-goals.server.ts";
import { normalizeWorkoutPlanModelDraft, workoutPlanModelInput } from "./plan-draft.ts";

const id = z.string().min(1).max(200);
const uuid = z.uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const positive = z.number().int().positive();
const empty = z.strictObject({});
const { exerciseId: _exerciseId, setId: _setId, ...actualSetFields } = workoutSetResultInput.shape;
const actualSetInput = z.strictObject(actualSetFields);
const historyFlags = {
  includeManualWorkouts: z.boolean().optional(),
  includeImportedWorkouts: z.boolean().optional(),
};
const sessionInput = workoutPlan
  .extend({
    detail: z.string().max(1000).default(""),
    abilityFlex: z.enum(["strict", "flexible"]).default("strict"),
    routeUrl: z
      .url({ protocol: /^https$/ })
      .max(500)
      .nullish(),
    capacity: z.number().int().min(2).max(4),
    visibility: z.enum(["public", "unlisted"]),
    joinMode: z.enum(["instant", "approve"]),
    womenOnly: z.boolean().default(false),
  })
  .strict();
const lookingInput = assistant.preferencesInput
  .omit({ enabled: true })
  .extend({
    role: z.literal("buddy").default("buddy"),
    womenOnly: z.boolean().optional(),
  })
  .strict();
const lookingCommand = z.strictObject({
  kind: z.literal("looking"),
  preferences: assistant.preferencesInput,
  expectedRevision: z.number().int().nonnegative(),
  womenOnly: z.boolean(),
  authorityRevision: z.number().int().nonnegative(),
  discoveryUpdatedAt: z.string().nullable(),
});
const sessionCommand = z.strictObject({ kind: z.literal("post_session"), session: sessionInput });
const bookingRef = { bookingId: id, sessionHash: hash };
export const commandInput = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("goal"),
    goal: goalInput,
    expectedRevision: z.number().int().nonnegative(),
    timeZone: z.string().max(100).default("UTC"),
  }),
  lookingCommand,
  z.strictObject({ kind: z.literal("ask_person"), contact: contacts.requestedContactInput }),
  sessionCommand,
  z.strictObject({
    kind: z.literal("confirm_plan"),
    roomId: uuid,
    revision: positive,
    termsHash: hash,
    timeZone: z.string().max(100),
  }),
  z.strictObject({
    kind: z.literal("book_plan"),
    roomId: uuid,
    revision: positive,
    termsHash: hash,
    timeZone: z.string().max(100),
  }),
  z.strictObject({ kind: z.literal("join_session"), sessionId: id, sessionHash: hash }),
  z.strictObject({ kind: z.literal("answer_request"), ...bookingRef, yes: z.boolean() }),
  z.strictObject({ kind: z.literal("save_workout"), plan: createPlanInput, runId: uuid }),
  z.strictObject({ kind: z.literal("log_set"), runId: uuid, input: updateRunInput }),
  z.strictObject({ kind: z.literal("checkin"), ...bookingRef }),
  z.strictObject({ kind: z.literal("repeat"), ...bookingRef }),
]);
export type AgentCommand = z.infer<typeof commandInput>;
export type PreparedAgentCard = {
  card: AgentChatCard;
  command: AgentCommand | null;
  label: string;
  description: string;
};
export type AgentToolContext = {
  now: number;
  timeZone: string;
  readManualWorkouts: () => Promise<unknown>;
  readWorkoutSummaries: () => Promise<unknown>;
};
type Definition = { description: string; inputSchema: z.ZodType };
export const agentToolDefinitions: Record<string, Definition> = {
  setGoal: {
    description:
      "Draft a private goal with the member's label, activity and exact date. A tap saves it; no session is scheduled.",
    inputSchema: goalInput,
  },
  setLookingFor: {
    description:
      "Draft complete buddy preferences and matching permission for one reviewed tap. Ask for missing levels, venues and dated availability; only buddy is supported.",
    inputSchema: lookingInput,
  },
  findPeople: {
    description:
      "Read at most three compatible partners from authorized matching; offer cards to ask their agents. No contacts are sent.",
    inputSchema: empty,
  },
  askPerson: {
    description:
      "Draft asking one previously returned compatible person's agent. A tap starts bounded agent coordination, never a direct member message.",
    inputSchema: z.strictObject({ memberId: id }),
  },
  draftSession: {
    description:
      "Draft a complete session with the entered level, public meeting venue and precise time. A tap posts it; ask for missing facts.",
    inputSchema: sessionInput,
  },
  reviewPlan: {
    description:
      "Read a shared proposal and offer the next exact plan or booking approval. Both members must approve; the tool cannot book.",
    inputSchema: z.strictObject({ negotiationId: uuid }),
  },
  findSessions: {
    description:
      "Read up to five visible upcoming sessions filtered by activity and exact times; offer reviewed join cards. No booking occurs.",
    inputSchema: z.strictObject({
      activity: activity.optional(),
      startAt: z.iso.datetime({ offset: true }).optional(),
      endAt: z.iso.datetime({ offset: true }).optional(),
      womenOnly: z.boolean().optional(),
    }),
  },
  joinSession: {
    description:
      "Draft joining one visible public session after showing its time, level and fees. A tap requests or confirms a seat.",
    inputSchema: z.strictObject({ id }),
  },
  answerRequest: {
    description:
      "Draft accepting or declining one pending request to a session the member hosts. A tap executes the decision.",
    inputSchema: z.strictObject({ bookingId: id, yes: z.boolean() }),
  },
  draftWorkoutPlan: {
    description:
      "Draft one editable future workout. A tap saves the shown plan and starts an empty workout record; planned targets never become actual exercise.",
    inputSchema: workoutPlanModelInput,
  },
  logSet: {
    description:
      "Draft one explicitly member-reported actual set, using zero-based exercise/set positions in their own run. Never infer completion, reps, time or load from targets. A tap records it.",
    inputSchema: z.strictObject({
      runId: uuid,
      exerciseIndex: z.number().int().min(0).max(11),
      setIndex: z.number().int().min(0).max(19),
      actual: actualSetInput,
    }),
  },
  myDay: {
    description:
      "Read the member's upcoming sessions and only the already-authorized bounded manual/imported workout summaries when relevant and permitted. Request only relevant history sources; missing readings remain unknown.",
    inputSchema: z.strictObject(historyFlags),
  },
  myProgress: {
    description:
      "Read private goal, recorded attendance counts and the already-authorized bounded workout summaries. Request only relevant history sources. Counts are records, not proof of physiological readiness.",
    inputSchema: z.strictObject(historyFlags),
  },
  checkIn: {
    description:
      "Offer a check-in card for the member's confirmed booking. The member supplies fresh device location or a host code at the tap; never fabricate evidence.",
    inputSchema: z.strictObject({ bookingId: id }),
  },
  againNextWeek: {
    description:
      "Draft a standing weekly slot from a completed session with mutual attendance. A tap creates the recurring commitment shown in the card.",
    inputSchema: z.strictObject({ bookingId: id }),
  },
  recapSession: {
    description:
      "Read the member's booking and bounded authorized history near its time. Coinciding workouts are not proof of session participation; never read the buddy's health.",
    inputSchema: z.strictObject({ bookingId: id, ...historyFlags }),
  },
};

const iso = (now: number) => new Date(now).toISOString();
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const changed = () =>
  new pace.PaceError(409, "This card is out of date. Ask your agent to review it again.");
const fees = [
  "Buddy sessions have no person-to-person payment.",
  `Cancel at least ${LATE_CANCEL_MS / 3600000} hours before for no fee; late cancellation may cost $${LATE_CANCEL_FEE_CENTS / 100}. Missing the session may cost $${NO_SHOW_FEE_CENTS / 100} and a strike.`,
];
function requireAgents() {
  if (process.env.A2A_ENABLED !== "true")
    throw new pace.PaceError(409, "Partner planning is unavailable right now.");
}
async function matchingRevision(sql: Sql, userId: string) {
  const [row] = await sql<{
    revision: number;
    updated_at: Date | null;
  }>`select a.revision,d.updated_at from agent_contact_authorities a
    left join agent_discovery_consents d on d.profile_id=a.profile_id where a.profile_id=${userId}`;
  return {
    authorityRevision: row?.revision ?? 0,
    discoveryUpdatedAt: row?.updated_at ? iso(+new Date(row.updated_at)) : null,
  };
}
function card(
  kind: AgentChatCard["kind"],
  label: string,
  facts: string[],
  primaryLabel: string | null,
  command: AgentCommand | null,
  now: number,
  input?: "checkin",
): PreparedAgentCard {
  return {
    label,
    description: facts.slice(0, 2).join(" ").slice(0, 500),
    command,
    card: {
      kind,
      title: label,
      facts,
      primaryLabel,
      expiresAt: iso(now + 30 * 60_000),
      ...(input ? { input } : {}),
    },
  };
}
function timeLabel(value: string, timeZone: string) {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "full", timeStyle: "short" }).format(
      new Date(value),
    ) + ` (${timeZone})`
  );
}
function sessionHash(s: pace.SessionDTO) {
  return digest({
    hostId: s.hostId,
    venueId: s.venueId,
    activity: s.activity,
    title: s.title,
    detail: s.detail,
    ability: s.ability,
    abilityFlex: s.abilityFlex,
    routeUrl: s.routeUrl,
    startAt: s.startAt,
    durationMin: s.durationMin,
    capacity: s.capacity,
    visibility: s.visibility,
    joinMode: s.joinMode,
    womenOnly: s.womenOnly,
    block: s.block?.id ?? null,
  });
}
async function venueName(sql: Sql, venueId: string) {
  const [venue] = await sql<{ name: string }>`select name from venues where id=${venueId}`;
  if (!venue) throw new pace.PaceError(400, "Choose a known public meeting place.");
  return venue.name;
}
async function sessionFacts(sql: Sql, s: z.infer<typeof sessionInput>, timeZone: string) {
  return [
    `${s.activity}: ${s.title}`,
    `${timeLabel(s.startAt, timeZone)} · ${s.durationMin} minutes`,
    `Meeting place: ${await venueName(sql, s.venueId)}`,
    `Level: ${abilityLabel(s.ability)} (${s.abilityFlex})`,
    `${s.capacity} people including the host · ${s.visibility} · ${s.joinMode === "approve" ? "host approval required" : "instant join"}${s.womenOnly ? " · women only" : ""}`,
    ...(s.detail ? [`Details: ${s.detail}`] : []),
    ...(s.routeUrl ? [`Route: ${s.routeUrl}`] : []),
    ...fees,
  ];
}
async function joinCard(sql: Sql, userId: string, sessionId: string, ctx: AgentToolContext) {
  const { session: s } = await pace.getSession(sql, userId, sessionId);
  if (
    s.visibility !== "public" ||
    s.hostId === userId ||
    s.status !== "open" ||
    new Date(s.startAt).getTime() <= ctx.now
  )
    throw new pace.PaceError(409, "This session is not available to join from chat.");
  // A regular training-block seat commits multiple weeks and needs its own review.
  if (s.block?.joinable && !s.substituteSeat)
    throw new pace.PaceError(
      409,
      "Review the full training block before joining its weekly sessions.",
    );
  return card(
    "session",
    s.title,
    await sessionFacts(sql, s, ctx.timeZone),
    s.joinMode === "approve" ? "Request this seat" : "Join this session",
    { kind: "join_session", sessionId, sessionHash: sessionHash(s) },
    ctx.now,
  );
}
async function planCard(
  sql: Sql,
  userId: string,
  roomId: string,
  ctx: AgentToolContext,
): Promise<PreparedAgentCard> {
  const room = await agents.getNegotiation(sql, userId, roomId, false, false, ctx.now);
  if (!room.plan)
    return card(
      "plan",
      "Your agents are planning",
      ["No plan is ready for approval yet."],
      null,
      null,
      ctx.now,
    );
  const review = await assistant.getBookingTerms(sql, userId, roomId, ctx.now),
    t = review.terms;
  const facts = [
    t.plan.title,
    `${timeLabel(t.plan.startAt, ctx.timeZone)} · ${t.plan.durationMin} minutes`,
    `Meeting place: ${await venueName(sql, t.plan.venueId)}`,
    `Level: ${abilityLabel(t.plan.ability)}`,
    "Private two-person session. Both people approve the plan and its booking terms.",
    `Due now: $${(t.chargeNowCents / 100).toFixed(2)} ${t.currency}. Late cancellation within ${t.lateCancelHours} hours may cost $${(t.lateCancelFeeCents / 100).toFixed(2)}; no-show may cost $${(t.noShowFeeCents / 100).toFixed(2)} and a strike.`,
  ];
  if (review.booked) return card("plan", "Workout booked", facts, null, null, ctx.now);
  if (!room.confirmations.includes(userId))
    return card(
      "plan",
      "Review this plan",
      facts,
      "Approve this plan",
      {
        kind: "confirm_plan",
        roomId,
        revision: room.revision,
        termsHash: t.termsHash,
        timeZone: ctx.timeZone,
      },
      ctx.now,
    );
  if (room.confirmations.length < 2)
    return card(
      "plan",
      "Waiting for your partner",
      [...facts, "Your plan approval is saved; your partner still needs to approve."],
      null,
      null,
      ctx.now,
    );
  if (review.approvedIds.includes(userId))
    return card(
      "plan",
      "Booking approval saved",
      [...facts, "Your partner still needs to accept these same booking terms."],
      null,
      null,
      ctx.now,
    );
  return card(
    "plan",
    "Review booking terms",
    facts,
    "Accept booking terms",
    {
      kind: "book_plan",
      roomId,
      revision: t.revision,
      termsHash: t.termsHash,
      timeZone: ctx.timeZone,
    },
    ctx.now,
  );
}
async function bookingAndSession(sql: Sql, userId: string, bookingId: string, now: number) {
  const booking = await pace.getBooking(sql, userId, bookingId, now);
  const { session } = await pace.getSession(sql, userId, booking.sessionId);
  return { booking, session };
}
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
function summaryFacts(manual: unknown, health: unknown) {
  const m = record(manual),
    h = record(health);
  const runs = Array.isArray(m.workoutRecords) ? m.workoutRecords.map(record).slice(0, 3) : [];
  const imported = Array.isArray(h.summaries) ? h.summaries.map(record).slice(0, 5) : [];
  const entered = runs.map(
    (r) =>
      `${String(r.title).slice(0, 120)}: ${r.completedSets} completed, ${r.skippedSets} skipped and ${r.unrecordedSets} unrecorded sets.`,
  );
  const observations = imported.map(
    (r) =>
      `${String(r.activity).slice(0, 50)} imported workout · ${String(r.startAt).slice(0, 40)}${typeof r.durationSeconds === "number" ? ` · ${Math.round(r.durationSeconds / 60)} minutes` : " · duration unknown"}.`,
  );
  return [
    ...entered,
    ...observations,
    m.available === false
      ? m.reason === "Not requested for this answer."
        ? "Saved workout history was not requested for this answer."
        : "Saved workout history is unavailable under your current privacy choices."
      : "Saved workouts are a bounded recent sample; planned sets are not completed exercise.",
    h.available === false
      ? h.reason === "Not requested for this answer."
        ? "Imported workout summaries were not requested for this answer."
        : "Imported workout summaries are unavailable under your current privacy choices."
      : "Imported summaries are source observations; missing readings remain unknown.",
  ];
}

export async function prepareAgentTool(
  sql: Sql,
  userId: string,
  name: string,
  args: unknown,
  ctx: AgentToolContext,
): Promise<{ data: unknown; drafts: PreparedAgentCard[] }> {
  const definition = agentToolDefinitions[name];
  if (!definition) throw new pace.PaceError(400, "Unknown agent tool.");
  definition.inputSchema.parse(args);
  if (["setLookingFor", "findPeople", "askPerson", "reviewPlan"].includes(name)) requireAgents();
  const out = (
    drafts: PreparedAgentCard[],
    data: unknown = { reviewOffered: true, saved: false },
  ) => ({ drafts, data });
  if (name === "setGoal") {
    const goal = goalInput.parse(args),
      prior = await getPrivateGoal(sql, userId);
    validateGoalDate(goal.date, ctx.now, ctx.timeZone);
    return out([
      card(
        "goal_draft",
        goal.label,
        [
          `Activity: ${goal.activity}`,
          `Goal date: ${goal.date}`,
          "This is a private intention. It does not schedule sessions or record exercise.",
          ...(prior ? [`Replaces your current goal: ${prior.label}`] : []),
        ],
        "Save my goal",
        { kind: "goal", goal, expectedRevision: prior?.revision ?? 0, timeZone: ctx.timeZone },
        ctx.now,
      ),
    ]);
  }
  if (name === "setLookingFor") {
    const input = lookingInput.parse(args),
      prior = await assistant.getPreferences(sql, userId);
    const { role: _role, womenOnly: requestedWomenOnly, ...p } = input;
    const currentMatching = await contacts.getAgentMatching(sql, userId, ctx.now);
    const womenOnly = requestedWomenOnly ?? currentMatching.womenOnly;
    const freshness = await matchingRevision(sql, userId);
    const preferences = assistant.preferencesInput.parse({ ...p, enabled: true });
    const valid = validAbility(p.activity, p.ability);
    if (!valid.ok) throw new pace.PaceError(400, valid.error);
    if (!p.venueIds.length || !p.availability.length)
      throw new pace.PaceError(400, "Choose a meeting place and available times first.");
    const places = await Promise.all(p.venueIds.map((v) => venueName(sql, v)));
    const facts = [
      `${p.activity} · ${abilityLabel(p.ability)} · ${p.durationMin} minutes`,
      `Public meeting places: ${places.join(", ")}`,
      ...p.availability.map(
        (w) => `${timeLabel(w.startAt, ctx.timeZone)} until ${timeLabel(w.endAt, ctx.timeZone)}`,
      ),
      ...(p.approvedIntent ? [`Your intention: ${p.approvedIntent}`] : []),
      `${womenOnly ? "Women-only partners. " : ""}Your agent may find compatible buddies and contact their agents using these entered preferences for up to seven days.`,
      "Names, levels, public attendance counts and compatible meeting options may be shown. Health data and private chat history are not shared. Both people still approve each plan and booking.",
    ];
    return out([
      card(
        "preferences_draft",
        "Review buddy preferences",
        facts,
        "Save and find a buddy",
        { kind: "looking", preferences, expectedRevision: prior.revision, womenOnly, ...freshness },
        ctx.now,
      ),
    ]);
  }
  if (name === "findPeople" || name === "askPerson") {
    const found = await contacts.agentContactCandidates(sql, userId, ctx.now);
    const wanted =
      name === "askPerson" ? z.strictObject({ memberId: id }).parse(args).memberId : null;
    const selected = found.candidates.filter((p) => !wanted || p.memberId === wanted);
    if (wanted && !selected.length)
      throw new pace.PaceError(
        409,
        "That person is not currently available in this partner search.",
      );
    const drafts = [];
    for (const p of selected) {
      const {
        memberId,
        preferenceRevision,
        partnerPreferenceRevision,
        authorityRevision,
        partnerAuthorityRevision,
      } = p;
      const facts = [
        `${p.activity} · ${p.level}`,
        `${p.completedCount} recorded completed sessions`,
        ...(await Promise.all(
          p.sharedTimes.map(
            async (t) =>
              `${timeLabel(t.startAt, ctx.timeZone)} · ${t.durationMin} minutes · ${await venueName(sql, t.venueId)}`,
          ),
        )),
        "Ask your agent to contact this person's agent and compare these shared preferences for up to 24 hours. No direct message, Health data or private chat is sent. Both people still approve any booking.",
      ];
      drafts.push(
        card(
          "person",
          `Meet ${p.firstName}`,
          facts,
          "Ask their agent",
          {
            kind: "ask_person",
            contact: {
              memberId,
              preferenceRevision,
              partnerPreferenceRevision,
              authorityRevision,
              partnerAuthorityRevision,
            },
          },
          ctx.now,
        ),
      );
    }
    return out(drafts, {
      candidates: selected.map((p) => ({
        memberId: p.memberId,
        firstName: p.firstName,
        activity: p.activity,
        level: p.level,
        completedSessions: p.completedCount,
      })),
      reason: found.reason,
      contacted: false,
    });
  }
  if (name === "draftSession") {
    const session = sessionInput.parse(args),
      valid = validAbility(session.activity, session.ability);
    if (!valid.ok) throw new pace.PaceError(400, valid.error);
    if (+new Date(session.startAt) < ctx.now + MIN_LEAD_TIME_MS)
      throw new pace.PaceError(400, "Choose a start at least 30 minutes from now.");
    return out([
      card(
        "session_draft",
        session.title,
        await sessionFacts(sql, session, ctx.timeZone),
        "Post this session",
        { kind: "post_session", session },
        ctx.now,
      ),
    ]);
  }
  if (name === "reviewPlan") {
    const { negotiationId } = z.strictObject({ negotiationId: uuid }).parse(args);
    return out([await planCard(sql, userId, negotiationId, ctx)]);
  }
  if (name === "findSessions") {
    const filters = agentToolDefinitions.findSessions.inputSchema.parse(args) as {
      activity?: string;
      startAt?: string;
      endAt?: string;
      womenOnly?: boolean;
    };
    const { sessions } = await pace.listPublicSessions(sql, userId, {
      womenOnly: filters.womenOnly,
    });
    const selected = sessions
      .filter(
        (s) =>
          s.hostId !== userId &&
          +new Date(s.startAt) > ctx.now &&
          (!filters.activity || s.activity === filters.activity) &&
          (!filters.startAt || +new Date(s.startAt) >= +new Date(filters.startAt)) &&
          (!filters.endAt || +new Date(s.startAt) <= +new Date(filters.endAt)) &&
          !(s.block?.joinable && !s.substituteSeat),
      )
      .slice(0, 5);
    return out(await Promise.all(selected.map((s) => joinCard(sql, userId, s.id, ctx))), {
      sessions: selected.map((s) => ({
        id: s.id,
        title: s.title,
        activity: s.activity,
        startAt: s.startAt,
        durationMin: s.durationMin,
        level: s.abilityLabel,
      })),
      booked: false,
    });
  }
  if (name === "joinSession")
    return out([await joinCard(sql, userId, z.strictObject({ id }).parse(args).id, ctx)]);
  if (name === "answerRequest" || name === "checkIn" || name === "againNextWeek") {
    const { bookingId } = z.object({ bookingId: id }).parse(args),
      { booking: b, session: s } = await bookingAndSession(sql, userId, bookingId, ctx.now);
    const ref = { bookingId, sessionHash: sessionHash(s) },
      facts = await sessionFacts(sql, s, ctx.timeZone);
    if (name === "answerRequest") {
      if (b.hostId !== userId || b.status !== "pending")
        throw new pace.PaceError(409, "There is no pending request for you to answer.");
      const { yes } = z.object({ yes: z.boolean() }).parse(args);
      const [person] = await sql<{
        name: string;
      }>`select name from profiles where id=${b.participantId}`;
      return out([
        card(
          "booking_request",
          yes ? "Approve this request" : "Decline this request",
          [`Request from ${person?.name.trim().split(/\s+/)[0] ?? "your partner"}`, ...facts],
          yes ? "Approve this seat" : "Decline this seat",
          { kind: "answer_request", ...ref, yes },
          ctx.now,
        ),
      ]);
    }
    if (name === "checkIn") {
      if (b.status !== "confirmed")
        throw new pace.PaceError(409, "Check-in needs a confirmed seat.");
      return out([
        card(
          "checkin",
          "Check in",
          [
            ...facts,
            "This tap uses your current device location or the host's fresh four-digit code. It records arrival, not a completed workout.",
          ],
          "Check in now",
          { kind: "checkin", ...ref },
          ctx.now,
          "checkin",
        ),
      ]);
    }
    if (b.status !== "completed")
      throw new pace.PaceError(409, "Repeat a session only after both people checked in.");
    return out([
      card(
        "again",
        "Make this a weekly workout",
        [
          ...facts,
          "Create a standing weekly slot at this time with the members who showed up. Weekly bookings continue until you leave; each occurrence keeps these cancellation/no-show rules.",
        ],
        "Repeat weekly",
        { kind: "repeat", ...ref },
        ctx.now,
      ),
    ]);
  }
  if (name === "draftWorkoutPlan") {
    const draft = normalizeWorkoutPlanModelDraft(workoutPlanModelInput.parse(args));
    const plan = createPlanInput.parse({
      id: randomUUID(),
      title: draft.title,
      activity: draft.activity,
      instructions: draft.instructions,
      exercises: draft.exercises.map((e) => ({
        id: randomUUID(),
        name: e.name,
        instructions: e.instructions,
        sets: Array.from({ length: e.sets }, () => ({
          id: randomUUID(),
          reps: e.reps,
          durationSeconds: e.durationSeconds,
          distanceMeters: null,
          weight: null,
          unit: "bodyweight",
          restSeconds: e.restSeconds,
        })),
      })),
    });
    const facts = [
      `${draft.activity} · ${draft.instructions || "Follow the reviewed exercise instructions."}`,
      ...draft.exercises.map(
        (e) =>
          `${e.name}: ${e.sets} sets · ${e.reps !== null ? `${e.reps} reps` : `${e.durationSeconds} seconds`} · rest ${e.restSeconds} seconds. ${e.instructions}`,
      ),
      "Save this private plan and start an empty workout record. Every actual set stays unrecorded until you enter it. This draft does not establish exercise safety or suitability.",
    ];
    return out([
      card(
        "workout_plan_draft",
        plan.title,
        facts,
        "Save and start",
        { kind: "save_workout", plan, runId: randomUUID() },
        ctx.now,
      ),
    ]);
  }
  if (name === "logSet") {
    const p = agentToolDefinitions.logSet.inputSchema.parse(args) as {
      runId: string;
      exerciseIndex: number;
      setIndex: number;
      actual: Omit<z.infer<typeof workoutSetResultInput>, "exerciseId" | "setId">;
    };
    const manual = record(await ctx.readManualWorkouts());
    const permitted =
      manual.available === true && Array.isArray(manual.workoutRecords)
        ? manual.workoutRecords.map(record).find((r) => r.runId === p.runId)
        : undefined;
    const visibleExercise =
      permitted && Array.isArray(permitted.exercises)
        ? record(permitted.exercises[p.exerciseIndex])
        : undefined;
    const visibleSet =
      visibleExercise && Array.isArray(visibleExercise.sets)
        ? visibleExercise.sets[p.setIndex]
        : undefined;
    if (!visibleSet)
      throw new pace.PaceError(
        403,
        "This workout set is outside the history currently shared with your coach.",
      );
    const run = await workouts.getRun(sql, userId, p.runId),
      exercise = run.snapshot.exercises[p.exerciseIndex],
      set = exercise?.sets[p.setIndex];
    if (!exercise || !set) throw new pace.PaceError(400, "Choose a set in your saved workout.");
    const result = workoutSetResultInput.parse({
      ...p.actual,
      exerciseId: exercise.id,
      setId: set.id,
    });
    const input = updateRunInput.parse({
      expectedRevision: run.revision,
      mutationId: randomUUID(),
      results: [...run.results.filter((r) => r.setId !== set.id), result],
      note: run.note,
      shareAccountability: run.shareAccountability,
      finish: run.status === "completed",
    });
    const amounts = [
      result.reps === null ? null : `${result.reps} reps`,
      result.durationSeconds === null ? null : `${result.durationSeconds} seconds`,
      result.distanceMeters === null ? null : `${result.distanceMeters} meters`,
      result.weight === null ? null : `${result.weight} ${result.unit}`,
    ].filter(Boolean);
    return out([
      card(
        "workout_set",
        `${exercise.name} · set ${p.setIndex + 1}`,
        [
          `Your entered result: ${result.status}${amounts.length ? ` · ${amounts.join(" · ")}` : ""}`,
          "This changes only the selected set in your private record. Planned targets are not copied into results.",
          run.shareAccountability
            ? "Your existing progress sharing remains on: buddies see status/set counts, never quantities or notes."
            : "Progress sharing remains off.",
        ],
        "Save this set",
        { kind: "log_set", runId: run.id, input },
        ctx.now,
      ),
    ]);
  }
  if (name === "myDay" || name === "myProgress") {
    const flags = z.strictObject(historyFlags).parse(args);
    const [goal, manual, health] = await Promise.all([
      getPrivateGoal(sql, userId),
      flags.includeManualWorkouts
        ? ctx.readManualWorkouts()
        : { available: false, reason: "Not requested for this answer." },
      flags.includeImportedWorkouts
        ? ctx.readWorkoutSummaries()
        : { available: false, reason: "Not requested for this answer." },
    ]);
    type BookingRef = {
      id: string;
      session_id: string;
      title: string;
      start_at: Date;
      status: string;
      host_id: string;
    };
    const next =
      await sql<BookingRef>`select b.id,b.session_id,s.title,s.start_at,b.status,s.host_id
      from bookings b join sessions s on s.id=b.session_id where (b.participant_id=${userId} or s.host_id=${userId})
      and s.start_at>=${iso(ctx.now - 25 * 60000)} and s.start_at<${iso(ctx.now + (name === "myDay" ? 1 : 14) * 86400000)}
      and b.status in ('pending','confirmed') order by s.start_at,b.id limit 20`;
    const recent =
      name === "myProgress"
        ? await sql<BookingRef>`select b.id,b.session_id,s.title,s.start_at,b.status,s.host_id
      from bookings b join sessions s on s.id=b.session_id where (b.participant_id=${userId} or s.host_id=${userId})
      and s.start_at>=${iso(ctx.now - 30 * 86400000)} and s.start_at<${iso(ctx.now)} and b.status='completed'
      order by s.start_at desc,b.id limit 20`
        : [];
    const unique = (rows: BookingRef[]) => [
      ...new Map(rows.map((r) => [r.session_id, r])).values(),
    ];
    const facts = [
      ...(goal
        ? [`Your goal: ${goal.label} · ${goal.activity} · ${goal.date}`]
        : ["No private goal is saved yet."]),
      ...unique(next)
        .slice(0, 8)
        .map(
          (r) =>
            `${r.title} · ${timeLabel(iso(+new Date(r.start_at)), ctx.timeZone)} · ${r.status}`,
        ),
      ...(name === "myProgress"
        ? [`${unique(recent).length} completed sessions in the bounded recent attendance sample.`]
        : []),
      ...(flags.includeManualWorkouts || flags.includeImportedWorkouts
        ? summaryFacts(manual, health)
        : []),
    ];
    const projection = (r: BookingRef) => ({
      bookingId: r.id,
      sessionId: r.session_id,
      title: r.title,
      startAt: iso(+new Date(r.start_at)),
      status: r.status,
      canAnswer: r.host_id === userId && r.status === "pending",
    });
    return out(
      [
        card(
          "progress",
          name === "myDay" ? "Your day" : "Your recorded progress",
          facts,
          null,
          null,
          ctx.now,
        ),
      ],
      {
        goal,
        sessions: next.map(projection),
        recentSessions: unique(recent).slice(0, 8).map(projection),
        recentCompleted: unique(recent).length,
        attendanceLimit:
          "At most 20 recent completed booking records from 30 days, grouped by session; not a complete attendance total.",
        manual,
        health,
      },
    );
  }
  if (name === "recapSession") {
    const { bookingId, ...flags } = z.strictObject({ bookingId: id, ...historyFlags }).parse(args),
      { booking: b, session: s } = await bookingAndSession(sql, userId, bookingId, ctx.now);
    const [manual, health] = await Promise.all([
      flags.includeManualWorkouts
        ? ctx.readManualWorkouts()
        : { available: false, reason: "Not requested for this answer." },
      flags.includeImportedWorkouts
        ? ctx.readWorkoutSummaries()
        : { available: false, reason: "Not requested for this answer." },
    ]);
    const start = +new Date(s.startAt),
      end = start + s.durationMin * 60_000;
    const overlaps = (v: unknown) => {
      const t = Date.parse(String(record(v).startAt ?? record(v).startedAt ?? ""));
      return Number.isFinite(t) && t >= start - 30 * 60_000 && t <= end + 30 * 60_000;
    };
    const h = record(health),
      m = record(manual);
    const healthNearby = Array.isArray(h.summaries) ? h.summaries.filter(overlaps) : [];
    const manualNearby = Array.isArray(m.workoutRecords) ? m.workoutRecords.filter(overlaps) : [];
    const facts = [
      s.title,
      timeLabel(s.startAt, ctx.timeZone),
      `Booking status: ${b.status}`,
      `Your recorded arrival: ${(b.hostId === userId ? b.hostCheckedInAt : b.participantCheckedInAt) ? "checked in" : "not recorded"}`,
      `${h.available === false ? "Imported history was not accessed" : `${healthNearby.length} imported workout records`}; ${m.available === false ? "saved workout history was not accessed" : `${manualNearby.length} saved workout records`} in the bounded nearby-time sample. Overlap does not prove that a workout belongs to this session.`,
      ...summaryFacts({ ...m, workoutRecords: manualNearby }, { ...h, summaries: healthNearby }),
    ];
    return out([card("recap", "Session recap", facts, null, null, ctx.now)], {
      bookingStatus: b.status,
      session: { title: s.title, startAt: s.startAt, durationMin: s.durationMin },
      healthNearby,
      manualNearby,
      limitation: facts[4],
    });
  }
  throw new pace.PaceError(400, "Unknown agent tool.");
}

/** The root execution transaction invokes this before identity/action locks. */
export async function lockAgentCommandProfiles(tx: Sql, userId: string, raw: unknown) {
  const command = commandInput.parse(raw),
    ids = new Set([userId]);
  let sessionId: string | undefined;
  if (command.kind === "ask_person") ids.add(command.contact.memberId);
  if (command.kind === "confirm_plan" || command.kind === "book_plan") {
    const [room] = await tx<{
      host_id: string;
      participant_id: string;
    }>`select host_id,participant_id from agent_negotiations
      where id=${command.roomId} and (host_id=${userId} or participant_id=${userId})`;
    if (!room) throw new pace.PaceError(404, "This plan is unavailable.");
    ids.add(room.host_id);
    ids.add(room.participant_id);
  }
  if ("bookingId" in command) {
    const [b] = await tx<{
      session_id: string;
      host_id: string;
      participant_id: string;
    }>`select b.session_id,s.host_id,b.participant_id
      from bookings b join sessions s on s.id=b.session_id where b.id=${command.bookingId}
      and (b.participant_id=${userId} or s.host_id=${userId})`;
    if (!b) throw new pace.PaceError(404, "This booking is unavailable.");
    sessionId = b.session_id;
    ids.add(b.host_id);
    ids.add(b.participant_id);
  }
  if (command.kind === "join_session") sessionId = command.sessionId;
  if (command.kind === "log_set" && command.input.shareAccountability) {
    const [run] = await tx<{
      session_id: string | null;
    }>`select session_id from workout_runs where id=${command.runId} and user_id=${userId}`;
    if (!run) throw new pace.PaceError(404, "This workout is unavailable.");
    sessionId = run.session_id ?? undefined;
  }
  if (sessionId) {
    const rows = await tx<{ id: string }>`select host_id as id from sessions where id=${sessionId}
      union select participant_id as id from bookings where session_id=${sessionId} and status in ('pending','confirmed','completed')
      union select m.profile_id as id from series_members m join sessions s on s.series_id=m.series_id where s.id=${sessionId} and m.left_at is null`;
    rows.forEach((r) => ids.add(r.id));
  }
  // Match domain reservations: serialize mutations without blocking unrelated FK checks.
  await tx`select id from profiles where id=any(${[...ids].sort()}::text[]) order by id for no key update`;
  if (sessionId) {
    const current = await tx<{
      id: string;
    }>`select host_id as id from sessions where id=${sessionId}
      union select participant_id as id from bookings where session_id=${sessionId} and status in ('pending','confirmed','completed')
      union select m.profile_id as id from series_members m join sessions s on s.series_id=m.series_id where s.id=${sessionId} and m.left_at is null`;
    if (current.some((r) => !ids.has(r.id))) throw changed();
  }
}

export async function executeAgentCommand(
  tx: Sql,
  userId: string,
  raw: unknown,
  interaction: unknown,
  now: number,
): Promise<{
  text: string;
  followups?: PreparedAgentCard[];
  related?: { kind: string; targetId: string };
}> {
  const command = commandInput.parse(raw);
  if (["looking", "ask_person", "confirm_plan", "book_plan"].includes(command.kind))
    requireAgents();
  const answer = (text: string, kind?: string, targetId?: string) => ({
    text,
    ...(kind && targetId ? { related: { kind, targetId } } : {}),
  });
  if (command.kind !== "checkin" && interaction !== undefined && interaction !== null)
    throw new pace.PaceError(400, "This action does not accept extra input.");
  switch (command.kind) {
    case "goal":
      await savePrivateGoal(
        tx,
        userId,
        command.goal,
        command.expectedRevision,
        now,
        command.timeZone,
      );
      return answer(`Saved your private goal: ${command.goal.label}.`);
    case "looking": {
      const previous = await assistant.getPreferences(tx, userId);
      if (previous.revision !== command.expectedRevision) throw changed();
      const freshness = await matchingRevision(tx, userId);
      if (
        freshness.authorityRevision !== command.authorityRevision ||
        freshness.discoveryUpdatedAt !== command.discoveryUpdatedAt
      )
        throw changed();
      const p = await assistant.setPreferences(tx, userId, command.preferences, now);
      await discovery.setDiscovery(
        tx,
        userId,
        { enabled: true, preferenceRevision: p.revision, womenOnly: command.womenOnly },
        now,
      );
      await contacts.setAgentMatching(
        tx,
        userId,
        { enabled: true, womenOnly: command.womenOnly },
        now,
      );
      return answer(
        "Saved your preferences. Your agent will check for compatible buddies; both people still approve a plan and booking.",
      );
    }
    case "ask_person": {
      const result = await contacts.requestAgentContact(tx, userId, command.contact, now);
      return answer(
        "Your agent contacted their agent. They will compare options; nothing is booked.",
        "negotiation",
        result.negotiationId,
      );
    }
    case "post_session": {
      const s = await pace.postSession(tx, userId, command.session, now);
      return answer(`Posted ${s.title}.`, "session", s.id);
    }
    case "confirm_plan":
    case "book_plan": {
      const current = await assistant.getBookingTerms(tx, userId, command.roomId, now);
      if (
        current.terms.revision !== command.revision ||
        current.terms.termsHash !== command.termsHash
      )
        throw changed();
      if (command.kind === "confirm_plan")
        await agents.confirmProposal(tx, userId, command.roomId, command.revision, now);
      else
        await assistant.approveBookingTerms(
          tx,
          userId,
          command.roomId,
          { revision: command.revision, termsHash: command.termsHash },
          now,
        );
      const ctx: AgentToolContext = {
        now,
        timeZone: command.timeZone,
        readManualWorkouts: async () => ({ available: false }),
        readWorkoutSummaries: async () => ({ available: false }),
      };
      const followup = await planCard(tx, userId, command.roomId, ctx);
      return {
        ...answer(
          command.kind === "confirm_plan"
            ? "Your plan approval is saved. Booking still requires both people to accept the terms."
            : "Your booking approval is saved. A workout is booked only after both people accept these terms.",
          "negotiation",
          command.roomId,
        ),
        followups: [followup],
      };
    }
    case "join_session": {
      const { session: s } = await pace.getSession(tx, userId, command.sessionId);
      if (
        s.visibility !== "public" ||
        sessionHash(s) !== command.sessionHash ||
        (s.block?.joinable && !s.substituteSeat)
      )
        throw changed();
      const b = await pace.bookSeat(tx, userId, s.id, {}, now);
      return answer(
        b.status === "pending"
          ? "Your seat request was sent to the host."
          : "Your seat is confirmed.",
        "booking",
        b.id,
      );
    }
    case "answer_request":
    case "checkin":
    case "repeat": {
      const { session: s } = await bookingAndSession(tx, userId, command.bookingId, now);
      if (sessionHash(s) !== command.sessionHash) throw changed();
      if (command.kind === "answer_request") {
        await (command.yes ? pace.approveBooking : pace.declineBooking)(
          tx,
          userId,
          command.bookingId,
          now,
        );
        return answer(
          command.yes ? "Approved the seat request." : "Declined the seat request.",
          "booking",
          command.bookingId,
        );
      }
      if (command.kind === "repeat") {
        const series = await pace.repeatWeekly(tx, userId, command.bookingId, now);
        return answer("Created your standing weekly slot.", "series", series.id);
      }
      const evidence = z
        .union([
          z.strictObject({ code: z.string().regex(/^\d{4}$/) }),
          z.strictObject({
            geo: z.strictObject({
              lat: z.number().min(-90).max(90),
              lng: z.number().min(-180).max(180),
              accuracyM: z.number().min(0).optional(),
            }),
          }),
        ])
        .parse(interaction);
      if ("code" in evidence)
        await pace.checkInCode(tx, userId, command.bookingId, evidence.code, now);
      else await pace.checkInGeo(tx, userId, command.bookingId, evidence.geo, now);
      return answer("Your arrival is recorded.", "booking", command.bookingId);
    }
    case "save_workout": {
      const p = await workouts.createPlan(tx, userId, command.plan, now);
      const run = await workouts.startRun(
        tx,
        userId,
        { id: command.runId, planId: p.id, expectedPlanRevision: p.revision },
        now,
      );
      return answer(
        "Saved your private plan and started an empty workout record. Enter each actual set as you perform it.",
        "workout_run",
        run.id,
      );
    }
    case "log_set": {
      const run = await workouts.updateRun(tx, userId, command.runId, command.input, now);
      return answer("Saved your entered set result.", "workout_run", run.id);
    }
  }
}
