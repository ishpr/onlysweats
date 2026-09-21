import assert from "node:assert/strict";
import test from "node:test";
import { appLinkTarget, inviteStage, nativeAppLink, validInviteCode } from "./app-links.ts";

test("cold and warm universal/custom-scheme invites land on the same stable route", () => {
  for (const link of [
    "https://samepace.app/invite/Abc_-123",
    "samepace://invite/Abc_-123",
    "samepace:///invite/Abc_-123",
    "/invite/Abc_-123?code=other&next=https://evil.test",
  ]) {
    assert.equal(nativeAppLink(link), "/invite/Abc_-123");
  }
  assert.deepEqual(
    [null, false, true, false].map((signedIn) => inviteStage("Abc_-123", signedIn)),
    ["loading", "sign-in", "resolve", "sign-in"],
  );
  assert.equal(validInviteCode(["Abc_-123", "other"]), null);
  assert.equal(inviteStage("%2Fbad", true), "invalid");
});

test("private shared pages retain only bounded destination fields through sign-in", () => {
  for (const target of [
    "/session/s_123?invite=abcd",
    "/training-block/t_123",
    "/verified",
    "/billing-return?session_id=cs_test_123",
  ]) {
    const handoff = new URL(nativeAppLink(`https://samepace.app${target}`), "https://samepace.app");
    assert.equal(handoff.pathname, "/open");
    assert.equal(appLinkTarget(handoff.searchParams.get("target")), target);
  }
  assert.equal(
    appLinkTarget("/billing-return?session_id=cs_test_123&paid=true"),
    "/billing-return?session_id=cs_test_123",
  );
  assert.equal(appLinkTarget("/billing-return?session_id=cs_1&session_id=cs_2"), "/billing-return");
  assert.equal(appLinkTarget("/session/s_123?invite=abcd&invite=efgh"), "/session/s_123");
});

test("external destinations, ambiguous IDs and injected paths cannot become a pending route", () => {
  for (const link of [
    "https://samepace.app.evil.test/invite/abcd",
    "https://evil.test/session/id",
    "https://member@samepace.app/session/id",
    "https://samepace.app:8443/session/id",
    "//evil.test/session/id",
    "/session/%2Fsecret",
    "/session/id/extra",
    "/invite/abc",
    "/invite/abcd%3Fcode=else",
    "/admin",
    "/open?target=/admin",
    "javascript:alert(1)",
  ]) {
    assert.equal(appLinkTarget(link), null, link);
  }
  assert.equal(nativeAppLink("samepace://invite/%broken"), "/invite/_");
  assert.equal(
    nativeAppLink("com.googleusercontent.apps.example:/oauthredirect"),
    "com.googleusercontent.apps.example:/oauthredirect",
  );
  assert.equal(
    nativeAppLink("exp+samepace://expo-development-client/?url=local"),
    "exp+samepace://expo-development-client/?url=local",
  );
});
