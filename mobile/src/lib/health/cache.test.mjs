import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { clearPrivateHealthCache } from "./cache.ts";

test("revocation clears every cached page and an in-flight read cannot restore private data", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(["private-health", "member", "workouts", "first"], ["workout with heart rate"]);
  client.setQueryData(["private-health", "member", "workouts", "older"], ["older workout"]);
  client.setQueryData(["private-fitness", "member", "correction", "workout"], ["private correction"]);
  client.setQueryData(["private-fitness", "member", "assessment", "workout"], ["private interpretation"]);
  client.setQueryData(["private-health", "another", "workouts"], ["other account"]);
  let finish;
  const pending = client.fetchQuery({ queryKey: ["private-health", "member", "workouts", "loading"], queryFn: ({ signal }) => {
    assert.equal(signal.aborted, false);
    return new Promise((resolve) => { finish = resolve; });
  } }).catch(() => undefined);
  await clearPrivateHealthCache(client, "member");
  finish(["late response"]);
  await pending;
  assert.equal(client.getQueriesData({ queryKey: ["private-health", "member"] }).length, 0);
  assert.equal(client.getQueriesData({ queryKey: ["private-fitness", "member"] }).length, 0);
  assert.deepEqual(client.getQueryData(["private-health", "another", "workouts"]), ["other account"]);
  client.clear();
});
