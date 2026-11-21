// What a page reported, turned into one time for each action. The functions
// that run in the page are covered by the real browser run in example.test.js.
import assert from "node:assert/strict";
import { test } from "node:test";
import { actionTimes, slowReport } from "../src/runner/measure.js";

test("a click is timed to the first change after it; one that changed nothing has no time", () => {
  assert.deepEqual(
    actionTimes([
      { kind: "action", at: 1000, name: "Share" },
      { kind: "change", at: 1024, text: "open on dialog" },
      { kind: "change", at: 1900, text: "a later change" },
      { kind: "action", at: 3000, name: "Copy link" },
      { kind: "action", at: 4000, name: "Done" },
      { kind: "change", at: 4003.4, text: "open on dialog" },
    ]),
    [{ name: "Share", ms: 24, changed: "open on dialog" }, { name: "Copy link", ms: null }, { name: "Done", ms: 3, changed: "open on dialog" }],
  );
});

test("a click that opened a new page is timed to that page's first paint; a page opened another way is its own line", () => {
  assert.deepEqual(
    actionTimes([
      { kind: "paint", at: 900, ms: 48.2, path: "/" },
      { kind: "action", at: 1000, name: "Open invoice" },
      { kind: "paint", at: 1310, ms: 120, path: "/invoices/7" },
      { kind: "paint", at: 5000, ms: 61, path: "/view/q3-plan" },
    ]),
    [{ name: "open /", ms: 48 }, { name: "Open invoice", ms: 310, changed: "opened /invoices/7" }, { name: "open /view/q3-plan", ms: 61 }],
  );
});

test("a slow replay's report names each line, its user and each time", () => {
  const lines = [
    { line: 1, user: "you", actions: [{ name: "Share", ms: 2017 }, { name: "Copy link", ms: null }] },
    { line: 2, user: "you", actions: [] },
    { line: 3, user: "viewer", actions: [{ name: "open /view/q3-plan", ms: 20 }] },
  ];
  assert.equal(slowReport(2000, lines), 'journeysfirst: slow replay, each data request delayed 2000 ms. No run was written.\nline 1 (you): "Share" 2017 ms, "Copy link" no change\nline 3 (viewer): "open /view/q3-plan" 20 ms');
  assert.equal(slowReport(2000, []), "journeysfirst: slow replay, each data request delayed 2000 ms. No run was written.\nNo action or page was timed.");
});
