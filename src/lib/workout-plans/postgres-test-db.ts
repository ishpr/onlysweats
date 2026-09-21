import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import type { Sql } from "../db.ts";

type Query = <T>(text: string, values?: unknown[]) => Promise<T[]>;
export function wrap(query: Query, transaction: Sql["transaction"]): Sql {
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`;
    return query(text, values);
  }) as Sql;
  sql.query = query;
  sql.transaction = transaction;
  return sql;
}
function sanitized(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return new Error(
    `Isolated PostgreSQL operation failed${typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? ` (${code})` : ""}.`,
  );
}
/** Fresh schema, no public fallback, bounded statements, cleanup verified. */
export async function postgresTestDatabase(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid test database configuration.");
  }
  assert.ok(["postgres:", "postgresql:"].includes(parsed.protocol));
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      process.env.SAMEPACE_TEST_ALLOW_REMOTE_SCHEMA === "1",
    "Remote schema-only acceptance requires explicit opt-in.",
  );
  const schema = `workout_race_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^workout_race_[a-f0-9]{32}$/);
  const pool = new pg.Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 12000 });
  pool.on("error", () => {});
  const direct: Query = async <T>(text: string, values?: unknown[]) => {
    try {
      return (await pool.query(text, values)).rows as T[];
    } catch (error) {
      throw sanitized(error);
    }
  };
  const transaction: Sql["transaction"] = async (fn) => {
    const client = await pool.connect().catch((error) => {
      throw sanitized(error);
    });
    const query: Query = async <T>(text: string, values?: unknown[]) => {
      try {
        return (await client.query(text, values)).rows as T[];
      } catch (error) {
        throw sanitized(error);
      }
    };
    try {
      await query("begin");
      await query(`set local search_path to ${schema}, pg_catalog`);
      await query("select set_config('application_name', $1, true)", [schema]);
      await query("set local statement_timeout = '15s'");
      await query("set local idle_in_transaction_session_timeout = '20s'");
      const [{ active }] = await query<{ active: string }>("select current_schema() active");
      assert.equal(active, schema);
      const tx: Sql = wrap(query, (nested) => nested(tx));
      const result = await fn(tx);
      await query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };
  const sql = wrap(
    <T>(text: string, values?: unknown[]) => transaction((tx) => tx.query<T>(text, values)),
    transaction,
  );
  let created = false;
  async function close() {
    try {
      if (created) {
        await direct(`drop schema ${schema} cascade`);
        const rows = await direct("select 1 from pg_namespace where nspname = $1", [schema]);
        assert.equal(rows.length, 0, "Temporary test schema must be removed.");
        created = false;
      }
    } finally {
      await pool.end();
    }
  }
  try {
    await direct(`create schema ${schema}`);
    created = true;
    const directory = new URL("../../../migrations/", import.meta.url);
    const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
    assert.ok(names.includes("0029_workout_plans.sql"));
    for (const name of names) {
      const source = await readFile(new URL(name, directory), "utf8");
      assert.doesNotMatch(
        source,
        /\bpublic\s*\.|\bsearch_path\b|\b(?:create|drop)\s+(?:schema|extension)\b|\balter\s+role\b/i,
      );
      await sql.query(source);
    }
    return { sql, close };
  } catch (error) {
    await close();
    throw error;
  }
}
