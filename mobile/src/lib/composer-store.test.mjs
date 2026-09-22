import assert from "node:assert/strict";
import { test } from "node:test";
import { createComposerStore } from "./composer-store.ts";

test("mounted Home and assistant routes cannot overwrite or clear each other's composer", () => {
  const store = createComposerStore();
  const home = Symbol("home");
  const assistant = Symbol("assistant");
  const closeHome = store.registerDock("home-route");
  store.registerDock("assistant-route");
  store.publish("home-route", home, "home draft");
  store.publish("assistant-route", assistant, "visible assistant draft");

  store.publish("home-route", home, "background poll render");
  assert.equal(store.read("assistant-route"), "visible assistant draft");
  store.release("home-route", home);
  closeHome();
  assert.equal(store.read("assistant-route"), "visible assistant draft");
});

test("blur removes the route's retained composer and refocus requires a fresh publication", () => {
  const store = createComposerStore();
  const owner = Symbol("home");
  const blur = store.registerDock("home-route");
  store.publish("home-route", owner, "private draft");
  blur();
  assert.equal(store.read("home-route"), null);
  assert.equal(store.hasDock("home-route"), false);

  store.publish("home-route", owner, "late hidden render");
  assert.equal(store.read("home-route"), null);
  store.registerDock("home-route");
  assert.equal(store.read("home-route"), null);
  store.publish("home-route", owner, "resumed draft");
  assert.equal(store.read("home-route"), "resumed draft");
});

test("late cleanup from replaced conversation or dock cannot clear its replacement", () => {
  const store = createComposerStore();
  const oldPortal = Symbol("cloud");
  const newPortal = Symbol("local");
  const closeOldDock = store.registerDock("assistant-route");
  store.publish("assistant-route", oldPortal, "old conversation");
  const closeNewDock = store.registerDock("assistant-route");
  store.publish("assistant-route", newPortal, "new conversation");

  store.release("assistant-route", oldPortal);
  closeOldDock();
  closeOldDock();
  assert.equal(store.read("assistant-route"), "new conversation");
  assert.equal(store.hasDock("assistant-route"), true);
  closeNewDock();
  assert.equal(store.read("assistant-route"), null);
});
