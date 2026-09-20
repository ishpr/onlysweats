/** An embedded Postgres with the shipped migrations applied, for service tests. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";

function wrap(q: { query: PGlite["query"] }, transaction: Sql["transaction"]): Sql {
  const run = async <T>(text: string, params: unknown[] = []) =>
    (await q.query<T>(text, params)).rows;
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run(text, values);
  }) as unknown as Sql;
  sql.query = run as Sql["query"];
  sql.transaction = transaction;
  return sql;
}

export async function makeDb(): Promise<Sql> {
  const pg = new PGlite({ parsers: { 20: Number } });
  const dir = join(import.meta.dirname, "../../../migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(join(dir, f), "utf8"));
  }
  return wrap(pg, (fn) =>
    pg.transaction((tx) => {
      const inner: Sql = wrap(tx as unknown as PGlite, (f) => f(inner));
      return fn(inner);
    }),
  );
}
