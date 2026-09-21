import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appleAssociationResponse, androidAssociationResponse } from "./association.server.ts";

const config = JSON.parse(
  readFileSync(new URL("../../../mobile/app.json", import.meta.url), "utf8"),
).expo;

test("Apple association and native entitlement agree on the shipped identity and invite scope", async () => {
  const response = appleAssociationResponse();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type")!, /application\/json/);
  assert.equal(response.headers.get("location"), null);
  const document = await response.json();
  assert.deepEqual(document.applinks.details, [
    {
      appIDs: [`NZBE9W77FA.${config.ios.bundleIdentifier}`],
      components: [
        "/invite/*",
        "/session/*",
        "/training-block/*",
        "/verified",
        "/billing-return",
      ].map((path) => ({ "/": path })),
    },
  ]);
  assert.deepEqual(config.ios.associatedDomains, ["applinks:samepace.app"]);
});

test("Android is unassociated without a real signing certificate; malformed config fails closed", async () => {
  const missing = androidAssociationResponse("");
  assert.deepEqual(await missing.json(), []);
  assert.equal(missing.headers.get("cache-control"), "no-store");
  for (const value of ["placeholder", "AA:".repeat(31), `${"AA:".repeat(31)}AA,`, "*"]) {
    const invalid = androidAssociationResponse(value);
    assert.equal(invalid.status, 503);
    assert.equal(invalid.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(
      await invalid.text(),
      new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
});

test("Android permits only explicitly supplied certificates and same-host invite intent filters", async () => {
  const first = Array(32).fill("AB").join(":");
  const second = Array(32).fill("CD").join(":");
  const response = androidAssociationResponse(` ${first.toLowerCase()}, ${second}, ${first} `);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type")!, /application\/json/);
  assert.deepEqual(await response.json(), [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: config.android.package,
        sha256_cert_fingerprints: [first, second],
      },
    },
  ]);
  assert.deepEqual(config.android.intentFilters, [
    {
      action: "VIEW",
      autoVerify: true,
      category: ["BROWSABLE", "DEFAULT"],
      data: ["/invite/", "/session/", "/training-block/", "/verified", "/billing-return"].map(
        (path) => ({
          scheme: "https",
          host: "samepace.app",
          ...(path.endsWith("/") ? { pathPrefix: path } : { path }),
        }),
      ),
    },
  ]);
});
