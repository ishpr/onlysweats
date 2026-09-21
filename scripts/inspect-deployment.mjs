#!/usr/bin/env node
// Read-only release evidence. Never print a connection string, credential, user,
// health record, or private query parameter.
import { createHash } from "node:crypto";
import pg from "pg";

const configured = (name) => Boolean(process.env[name]?.trim());
const report = {
  databaseConfigured: configured("DATABASE_URL"),
  healthEnabled: process.env.HEALTH_SYNC_ENABLED === "true",
  agentsEnabled: process.env.A2A_ENABLED === "true",
  jevEnabled: process.env.JEV_ENABLED === "true",
  jevKeyConfigured: configured("TYPESAFE_API_KEY"),
  cronConfigured: configured("CRON_SECRET"),
};
if (report.databaseConfigured) {
  let pool;
  let client;
  try {
    const url = new URL(process.env.DATABASE_URL);
    // Pooled/unpooled Neon aliases point to the same database branch.
    report.databaseEndpointFingerprint = createHash("sha256")
      .update(url.hostname.replace(/-pooler(?=\.)/, ""))
      .digest("hex");
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 10_000,
    });
    client = await pool.connect();
    await client.query("begin read only");
    report.migrations = (await client.query("select name from _migrations order by name")).rows.map(
      (row) => row.name,
    );
    await client.query("commit");
  } catch {
    await client?.query("rollback").catch(() => undefined);
    report.databaseReadFailed = true;
  } finally {
    client?.release();
    await pool?.end().catch(() => undefined);
  }
}
console.log(JSON.stringify(report));
