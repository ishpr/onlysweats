import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { makeDb } from "../pace/test-db.ts";
import type { Sql } from "../db.ts";
import { ensureProfile } from "../pace/service.server.ts";
import {
  CHAT_NOTICE_VERSION,
  type ChatEvent,
  type ChatSettings,
} from "../../../shared/conversation.ts";
import {
  ChatError,
  acceptAppTerms,
  chatResponse,
  clearHistory,
  getHistory,
  readChatBody,
  setSettings,
  pruneConversations,
  turnInput,
} from "./service.server.ts";
import { APP_TERMS_VERSION } from "../../../shared/app-terms.ts";
import type { ChatProvider } from "./provider.server.ts";
import * as health from "../health/service.server.ts";
import type { HealthConnection, WorkoutRecord } from "../../../shared/health.ts";
let sql: Sql;
before(async () => {
  sql = await makeDb();
});
async function member(enabled = true) {
  const id = randomUUID();
  await sql`insert into "user" (id,name,email,"emailVerified") values (${id},'Chat fixture',${`${id}@example.test`},true)`;
  await ensureProfile(sql, { id, name: "Chat fixture", email: `${id}@example.test` });
  const { settings } = await setSettings(sql, id, {
    cloudEnabled: enabled,
    fitnessContextEnabled: false,
    noticeVersion: CHAT_NOTICE_VERSION,
  });
  return { id, settings };
}
const input = (s: ChatSettings, text = "Help me plan an easy run") => ({
  requestId: randomUUID(),
  text,
  consentGeneration: s.consentGeneration,
  historyGeneration: s.historyGeneration,
});
async function events(response: Response): Promise<ChatEvent[]> {
  return (await response.text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((s) => JSON.parse(s));
}
const answer: ChatProvider = async ({ onText }) => {
  await onText("Let's review ");
  await onText("your preferences.");
};
const options = (provider = answer) => ({ available: true, provider });
const signal = () => new AbortController().signal;
const rejected = (p: Promise<unknown>, status: number) =>
  assert.rejects(p, (e) => e instanceof ChatError && e.status === status);
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function fitnessMember() {
  const { id } = await member();
  const { settings } = await setSettings(sql, id, {
    cloudEnabled: true,
    fitnessContextEnabled: true,
    noticeVersion: CHAT_NOTICE_VERSION,
  });
  const connection = await health.connect(sql, id, {
    deviceId: randomUUID(),
    types: ["workout", "heart_rate"],
  });
  const record: WorkoutRecord = {
    externalId: randomUUID(),
    source: { bundleId: "app.samepace.test", name: "Test recorder" },
    startAt: new Date(Date.now() - 3600_000).toISOString(),
    endAt: new Date(Date.now() - 1800_000).toISOString(),
    type: "workout",
    activity: "run",
    durationSeconds: 1800,
    distanceMeters: null,
    activeEnergyKilocalories: null,
  };
  const synced = await health.sync(sql, id, healthPage(connection, [record]));
  return { id, settings, connection: synced, record };
}
const healthPage = (
  connection: HealthConnection,
  records: WorkoutRecord[] = [],
  deletedIds: string[] = [],
) => ({
  deviceId: connection.deviceId,
  generation: connection.generation,
  type: "workout",
  expectedSequence: connection.cursors.workout!.sequence,
  records,
  deletedIds,
  anchor: randomUUID(),
  hasMore: false,
});

describe("private assistant conversations", () => {
  it("reads current agent matching status without sending contact or inventing a partner count", async () => {
    const prior = process.env.A2A_ENABLED;
    process.env.A2A_ENABLED = "true";
    try {
      const { id, settings } = await member();
      await acceptAppTerms(sql, id, { version: APP_TERMS_VERSION });
      let planning: Record<string, unknown> | undefined;
      const result = await events(
        await chatResponse(
          sql,
          id,
          input(settings),
          signal(),
          options(async ({ tools, onText }) => {
            planning = (await tools.planning()) as Record<string, unknown>;
            await tools.review("discovery");
            await onText("Review your times and meeting places for automatic matching.");
          }),
        ),
      );
      assert.deepEqual(planning?.matching, {
        enabled: true,
        ready: false,
        reason:
          "Save current workout preferences and available times so your agent can find a partner.",
        needs: "preferences",
        lastCheckedAt: null,
      });
      assert.ok(!Object.hasOwn(planning!, "compatiblePartnerCount"));
      assert.ok(!Object.hasOwn(planning!, "discoveryEnabled"));
      assert.equal(
        (await sql`select 1 from agent_negotiations where host_id=${id} or participant_id=${id}`)
          .length,
        0,
      );
      assert.ok(JSON.stringify(result).includes("Review automatic matching status"));
    } finally {
      if (prior === undefined) delete process.env.A2A_ENABLED;
      else process.env.A2A_ENABLED = prior;
    }
  });
  it("requires explicit current consent, rejects unknown fields, and never calls a disabled provider", async () => {
    const { id, settings } = await member(false);
    let called = false;
    await rejected(
      chatResponse(
        sql,
        id,
        input(settings),
        signal(),
        options(async () => {
          called = true;
        }),
      ),
      403,
    );
    await rejected(chatResponse(sql, id, input(settings), signal(), { available: false }), 503);
    assert.equal(called, false);
    assert.equal(turnInput.safeParse({ ...input(settings), userId: "another" }).success, false);
    assert.equal(turnInput.safeParse(input(settings, "x".repeat(2001))).success, false);
    await assert.rejects(
      setSettings(sql, id, {
        cloudEnabled: false,
        fitnessContextEnabled: true,
        noticeVersion: CHAT_NOTICE_VERSION,
      }),
    );
  });
  it("streams bounded text and private persisted history, with idempotent completed retries", async () => {
    const { id, settings } = await member();
    const other = await member();
    const turn = input(settings);
    const first = await events(await chatResponse(sql, id, turn, signal(), options()));
    assert.deepEqual(
      first.map((e) => e.type),
      ["start", "delta", "delta", "done"],
    );
    const history = await getHistory(sql, id);
    assert.equal(history.messages.length, 2);
    assert.equal(history.messages[0].text, turn.text);
    assert.equal(history.messages[1].text, "Let's review your preferences.");
    assert.equal((await getHistory(sql, other.id)).messages.length, 0);
    let calls = 0;
    const retry = await events(
      await chatResponse(
        sql,
        id,
        turn,
        signal(),
        options(async () => {
          calls++;
        }),
      ),
    );
    assert.equal(retry.at(-1)?.type, "done");
    assert.equal(calls, 0);
    assert.equal((await getHistory(sql, id)).messages.length, 2);
    await rejected(
      chatResponse(sql, id, { ...turn, text: "Changed message" }, signal(), options()),
      409,
    );
  });
  it("never provides workout history without separate permission and only emits server-built review actions", async () => {
    const { id, settings } = await member();
    const response = await events(
      await chatResponse(
        sql,
        id,
        input(settings),
        signal(),
        options(async ({ tools, onText }) => {
          assert.deepEqual(await tools.workouts(), {
            available: false,
            reason:
              "Separate fitness context permission is off. Ask the member to enable it if they want to share summaries.",
          });
          await tools.review("fitness");
          await onText("Review the exercise before saving.");
        }),
      ),
    );
    const action = response.find((e) => e.type === "action");
    assert.equal(action?.type === "action" && action.action.kind, "fitness");
    assert.equal((await sql`select * from fitness_strength_logs where user_id = ${id}`).length, 0);
    assert.equal((await sql`select * from bookings where participant_id = ${id}`).length, 0);
  });
  it("serializes concurrent turns, releases failed leases, and never exposes provider errors", async () => {
    const { id, settings } = await member();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const response = await chatResponse(
      sql,
      id,
      input(settings),
      signal(),
      options(async () => {
        entered();
        await wait;
        throw new Error("secret provider payload");
      }),
    );
    await started;
    await rejected(chatResponse(sql, id, input(settings), signal(), options()), 409);
    release();
    const result = await events(response);
    assert.equal(result.at(-1)?.type, "error");
    assert.equal(JSON.stringify(result).includes("secret provider"), false);
    const next = await events(await chatResponse(sql, id, input(settings), signal(), options()));
    assert.equal(next.at(-1)?.type, "done");
  });
  it("revoking consent during generation removes history and prevents late text and writes", async () => {
    const { id, settings } = await member();
    const result = await events(
      await chatResponse(
        sql,
        id,
        input(settings),
        signal(),
        options(async ({ onText }) => {
          await onText("Before revocation.");
          await setSettings(sql, id, {
            cloudEnabled: false,
            fitnessContextEnabled: false,
            noticeVersion: CHAT_NOTICE_VERSION,
          });
          await onText("MUST NOT APPEAR");
        }),
      ),
    );
    assert.equal(result.at(-1)?.type, "error");
    assert.equal(JSON.stringify(result).includes("MUST NOT"), false);
    assert.equal((await getHistory(sql, id)).messages.length, 0);
  });
  it("history reset invalidates in-flight work and old generation retries", async () => {
    const { id, settings } = await member();
    const turn = input(settings);
    const result = await events(
      await chatResponse(
        sql,
        id,
        turn,
        signal(),
        options(async ({ onText }) => {
          await clearHistory(sql, id);
          await onText("MUST NOT APPEAR");
        }),
      ),
    );
    assert.equal(result.at(-1)?.type, "error");
    assert.equal((await getHistory(sql, id)).messages.length, 0);
    await rejected(chatResponse(sql, id, turn, signal(), options()), 409);
  });
  it("aborts before a provider call and rejects suspended owners", async () => {
    const { id, settings } = await member();
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const result = await events(
      await chatResponse(
        sql,
        id,
        input(settings),
        controller.signal,
        options(async () => {
          calls++;
        }),
      ),
    );
    assert.equal(result.at(-1)?.type, "error");
    assert.equal(calls, 0);
    await sql`update profiles set suspended_at=now() where id=${id}`;
    await rejected(chatResponse(sql, id, input(settings), signal(), options()), 403);
    await clearHistory(sql, id);
    assert.equal((await getHistory(sql, id)).messages.length, 0);
  });
  it("caps tool use and output, preserves missing data and enforces daily limits", async () => {
    const { id, settings } = await member();
    let result = await events(
      await chatResponse(
        sql,
        id,
        input(settings),
        signal(),
        options(async ({ tools, onText }) => {
          for (let i = 0; i < 7; i++) await tools.workouts();
          await onText("not reached");
        }),
      ),
    );
    assert.equal(result.at(-1)?.type, "error");
    result = await events(
      await chatResponse(
        sql,
        id,
        input(settings),
        signal(),
        options(async ({ onText }) => {
          await onText("x".repeat(12001));
        }),
      ),
    );
    assert.equal(result.at(-1)?.type, "error");
    // Quotas reset in UTC, independent of the database's configured timezone.
    await sql`update assistant_chat_settings set request_count=50,request_day=${new Date().toISOString().slice(0, 10)} where user_id=${id}`;
    await rejected(chatResponse(sql, id, input(settings), signal(), options()), 429);
  });
  it("account deletion cascades conversations and retention cleanup runs without opening chat", async () => {
    const { id, settings } = await member();
    await events(await chatResponse(sql, id, input(settings), signal(), options()));
    await pruneConversations(sql, Date.now() + 31 * 86400_000);
    assert.equal((await getHistory(sql, id)).messages.length, 0);
    await sql`delete from "user" where id=${id}`;
    assert.equal((await sql`select * from assistant_chat_settings where user_id=${id}`).length, 0);
  });
  it("bounds a streaming body without trusting Content-Length", async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("x".repeat(17000)));
        c.close();
      },
    });
    await rejected(
      readChatBody(
        new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit),
      ),
      413,
    );
    await rejected(
      readChatBody(new Request("http://localhost", { method: "POST", body: '{"secret": invalid' })),
      400,
    );
  });
  it("fences cleanup and late callbacks when an expired attempt is retried with the same message id", async () => {
    const { id, settings } = await member();
    const turn = input(settings);
    const startedAt = Date.now();
    const oldStarted = latch(),
      oldFinish = latch(),
      newStarted = latch(),
      newFinish = latch();
    const old = await chatResponse(sql, id, turn, signal(), {
      ...options(async ({ onText }) => {
        oldStarted.release();
        await oldFinish.promise;
        await onText("STALE REPLY");
      }),
      now: () => startedAt,
    });
    await oldStarted.promise;
    const current = await chatResponse(sql, id, turn, signal(), {
      ...options(async ({ onText }) => {
        newStarted.release();
        await newFinish.promise;
        await onText("Current reply");
      }),
      now: () => startedAt + 61_000,
    });
    await newStarted.promise;
    oldFinish.release();
    const oldEvents = await events(old);
    assert.equal(oldEvents.at(-1)?.type, "error");
    assert.equal(JSON.stringify(oldEvents).includes("STALE REPLY"), false);
    const [lease] =
      await sql`select active_attempt_id from assistant_chat_settings where user_id = ${id}`;
    assert.ok(lease.active_attempt_id, "old cleanup must not clear the replacement attempt");
    await rejected(
      chatResponse(sql, id, input(settings), signal(), {
        ...options(),
        now: () => startedAt + 61_001,
      }),
      409,
    );
    newFinish.release();
    assert.equal((await events(current)).at(-1)?.type, "done");
    assert.equal((await getHistory(sql, id)).messages.length, 2);
  });
  it("cancels promptly even if the provider ignores its abort signal", async () => {
    const { id, settings } = await member();
    const controller = new AbortController();
    const started = latch();
    const response = await chatResponse(
      sql,
      id,
      input(settings),
      controller.signal,
      options(async () => {
        started.release();
        await new Promise<void>(() => {});
      }),
    );
    await started.promise;
    controller.abort();
    assert.equal((await events(response)).at(-1)?.type, "error");
    assert.equal(
      (await events(await chatResponse(sql, id, input(settings), signal(), options()))).at(-1)
        ?.type,
      "done",
    );
  });
  it("clears derived chat for health deletion, source tombstones, disconnect and permission withdrawal", async () => {
    const prior = process.env.HEALTH_SYNC_ENABLED;
    process.env.HEALTH_SYNC_ENABLED = "true";
    try {
      for (const removal of ["delete", "tombstone", "disconnect", "permission"] as const) {
        const { id, settings, connection, record } = await fitnessMember();
        const result = await events(
          await chatResponse(
            sql,
            id,
            input(settings),
            signal(),
            options(async ({ tools, onText }) => {
              const context = (await tools.workouts()) as {
                summaries: { distanceMeters: null; heartRate: { availability: string } }[];
              };
              assert.equal(context.summaries[0].distanceMeters, null);
              assert.equal(context.summaries[0].heartRate.availability, "unavailable");
              await onText("Your recorded run lasted 30 minutes.");
            }),
          ),
        );
        assert.equal(result.at(-1)?.type, "done");
        if (removal === "delete") await health.deleteWorkout(sql, id, record.externalId);
        if (removal === "tombstone")
          await health.sync(sql, id, healthPage(connection, [], [record.externalId]));
        if (removal === "disconnect") await health.disconnect(sql, id);
        if (removal === "permission")
          await health.connect(sql, id, { deviceId: connection.deviceId, types: ["workout"] });
        const history = await getHistory(sql, id);
        assert.equal(history.messages.length, 0, removal);
        assert.notEqual(history.settings.historyGeneration, settings.historyGeneration, removal);
      }
    } finally {
      if (prior === undefined) delete process.env.HEALTH_SYNC_ENABLED;
      else process.env.HEALTH_SYNC_ENABLED = prior;
    }
  });
  it("invalidates in-flight workout answers when their source is removed or revised", async () => {
    const prior = process.env.HEALTH_SYNC_ENABLED;
    process.env.HEALTH_SYNC_ENABLED = "true";
    try {
      for (const removal of [true, false]) {
        const { id, settings, record, connection } = await fitnessMember();
        const result = await events(
          await chatResponse(
            sql,
            id,
            input(settings),
            signal(),
            options(async ({ tools, onText }) => {
              await tools.workouts();
              await onText("Preliminary reply");
              if (removal) await health.deleteWorkout(sql, id, record.externalId);
              else
                await health.sync(
                  sql,
                  id,
                  healthPage(connection, [{ ...record, durationSeconds: 900 }]),
                );
            }),
          ),
        );
        assert.equal(result.at(-1)?.type, "error");
        assert.equal(
          (await getHistory(sql, id)).messages.filter((m) => m.role === "assistant").length,
          0,
        );
      }
    } finally {
      if (prior === undefined) delete process.env.HEALTH_SYNC_ENABLED;
      else process.env.HEALTH_SYNC_ENABLED = prior;
    }
  });
  it("preserves conversation that never read imported health data", async () => {
    const { id, settings, record } = await fitnessMember();
    await events(await chatResponse(sql, id, input(settings), signal(), options()));
    await health.deleteWorkout(sql, id, record.externalId);
    assert.equal((await getHistory(sql, id)).messages.length, 2);
  });
});
