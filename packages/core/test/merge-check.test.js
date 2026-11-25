import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mergeCheck } from "../src/format/merge-check.js";
import { JOURNEY, ON, PNG, VIEWER_SAW, recordAllPassed, recorder } from "./helpers.js";

const BIN = new URL("../bin/journeysfirst.js", import.meta.url).pathname;

function project() {
  const dir = mkdtempSync(join(tmpdir(), "jf-merge-"));
  mkdirSync(join(dir, "journeys"));
  writeFileSync(join(dir, "journeys/share-by-link.journey.yaml"), JOURNEY);
  return dir;
}

/** A run where the viewer could not be signed in, so the viewer's checks are blocked. */
function recordViewerBlocked(run) {
  run.step(1, { by: "you", screenshots: PNG });
  run.check("link-on", { by: "you", verdict: "passed", proof: "Reloaded and read the saved setting.", evidence: [ON] });
  run.blocked("The viewer opens the link.", { reason: "The viewer's account could not be made." });
  return run;
}

const check = (dir, runs, main) => mergeCheck({ journeysDir: join(dir, "journeys"), runsDir: join(dir, runs), mainDir: main && join(dir, main) });

test("merge-check is ok when every journey has a run in which every check passed", () => {
  const dir = project();
  recordAllPassed(recorder({ outputDir: join(dir, "journey-runs") })).finish();
  const { ok, lines } = check(dir, "journey-runs");
  assert.equal(ok, true);
  assert.deepEqual(lines, [{ journey: "share-by-link", case: null, ok: true, says: "passed" }]);
});

test("merge-check stops a journey with no run", () => {
  const { ok, lines } = check(project(), "journey-runs");
  assert.equal(ok, false);
  assert.match(lines[0].says, /no run in/);
});

test("merge-check stops a newer aborted attempt instead of falling back to a pass", () => {
  const dir = project();
  const outputDir = join(dir, "journey-runs");
  const passed = recordAllPassed(recorder({ outputDir })).finish().run;
  assert.equal(check(dir, "journey-runs").ok, true);

  const attempt = { status: "aborted", reason: "The runner exited unexpectedly." };
  let ms = Date.parse("2026-11-08T18:03:00Z");
  const { run } = recordAllPassed(recorder({ outputDir, now: () => (ms += 500) })).finish({ attempt });
  assert.deepEqual(run.steps, passed.steps);
  const gate = spawnSync(process.execPath, [BIN, "merge-check"], { cwd: dir, encoding: "utf8" });
  assert.equal(gate.status, 1, gate.stdout + gate.stderr);
  assert.match(gate.stdout, /NO {2}share-by-link: attempt aborted: The runner exited unexpectedly\./);
});

test("merge-check stops an aborted attempt even when its blocked checks were blocked on main", () => {
  const dir = project();
  recordViewerBlocked(recorder({ outputDir: join(dir, "main-runs") })).finish();
  recordViewerBlocked(recorder({ outputDir: join(dir, "journey-runs") })).finish({
    attempt: { status: "aborted", reason: "The runner timed out." },
  });
  const { ok, lines } = check(dir, "journey-runs", "main-runs");
  assert.equal(ok, false);
  assert.equal(lines[0].says, "attempt aborted: The runner timed out.");
});

test("merge-check stops a failed check, even when main failed it too", () => {
  const dir = project();
  for (const runs of ["journey-runs", "main-runs"]) {
    const run = recorder({ outputDir: join(dir, runs) });
    run.step(1, { by: "you" });
    run.check("link-on", { by: "you", verdict: "failed", proof: "The setting was off after a reload.", reason: "Link sharing turned itself off.", evidence: [{ ...ON, got: { linkSharing: false } }] });
    run.finish();
  }
  const { ok, lines } = check(dir, "journey-runs", "main-runs");
  assert.equal(ok, false);
  assert.match(lines[0].says, /^link-on failed/);
});

test("merge-check stops a blocked check unless main's newest run blocked the same check", () => {
  const dir = project();
  recordViewerBlocked(recorder({ outputDir: join(dir, "journey-runs") })).finish();

  const alone = check(dir, "journey-runs");
  assert.equal(alone.ok, false);
  assert.match(alone.lines[0].says, /viewer-sees-it blocked \(no main run to compare\)/);

  recordAllPassed(recorder({ outputDir: join(dir, "main-passed") })).finish();
  const worse = check(dir, "journey-runs", "main-passed");
  assert.equal(worse.ok, false);
  assert.match(worse.lines[0].says, /viewer-sees-it blocked \(not blocked on main\)/);

  recordViewerBlocked(recorder({ outputDir: join(dir, "main-blocked") })).finish();
  const same = check(dir, "journey-runs", "main-blocked");
  assert.equal(same.ok, true, same.lines[0].says);
  assert.equal(same.lines[0].says, "passed, except viewer-sees-it, viewer-blocked: blocked here and on main");
});

test("merge-check stops a run with a failed step of any cause, even when its blocked checks were blocked on main", () => {
  const dir = project();
  recordViewerBlocked(recorder({ outputDir: join(dir, "main-runs") })).finish();
  const run = recordViewerBlocked(recorder({ outputDir: join(dir, "journey-runs") }));
  run.step("Turn off link sharing.", { by: "you", status: "failed", cause: "test", reason: "The script threw." });
  run.finish();
  const { ok, lines } = check(dir, "journey-runs", "main-runs");
  assert.equal(ok, false);
  assert.equal(lines[0].says, "a step failed (cause test): Turn off link sharing.");
});

test("merge-check takes the newest run by time, not by how the time is written", () => {
  const dir = project();
  const passed = recordAllPassed(recorder({ outputDir: join(dir, "journey-runs") })).finish();
  const failed = recorder({ outputDir: join(dir, "journey-runs") });
  failed.step(1, { by: "you" });
  failed.check("link-on", { by: "you", verdict: "failed", proof: "The setting was off.", reason: "Link sharing turned itself off.", evidence: [{ ...ON, got: { linkSharing: false } }] });
  const { folder } = failed.finish();
  // 14:00Z and 10:00-05:00 (15:00Z): as text the passed run sorts last, by time the failed one is newer.
  const setStart = (runFolder, at) => {
    const file = join(runFolder, "run.json");
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), started_at: at }, null, 2));
  };
  setStart(passed.folder, "2026-11-11T14:00:00Z");
  setStart(folder, "2026-11-11T10:00:00-05:00");
  const { ok, lines } = check(dir, "journey-runs");
  assert.equal(ok, false);
  assert.match(lines[0].says, /^link-on failed/);
});

test("merge-check counts a claimed pass with no evidence as not checked, and stops it", () => {
  const dir = project();
  const run = recorder({ outputDir: join(dir, "journey-runs") });
  run.step(1, { by: "you" });
  run.check("link-on", { by: "you", verdict: "passed", proof: "Looked fine.", evidence: [ON] });
  run.step("The viewer opens the link.", { by: "viewer" });
  run.check("viewer-sees-it", { by: "viewer", verdict: "passed", proof: "Looked fine." });
  run.step("Turn off link sharing.", { by: "you" });
  run.step("The viewer opens the link again.", { by: "viewer" });
  run.check("viewer-blocked", { by: "viewer", verdict: "passed", proof: "Opened it again.", evidence: [{ ...VIEWER_SAW, saw: "an access error" }] });
  run.finish();
  const { ok, lines } = check(dir, "journey-runs");
  assert.equal(ok, false);
  assert.match(lines[0].says, /viewer-sees-it not_checked/);
});

test("the merge-check command prints a line per journey and exits 1 when one stops the merge", () => {
  const dir = project();
  const stopped = spawnSync(process.execPath, [BIN, "merge-check"], { cwd: dir, encoding: "utf8" });
  assert.equal(stopped.status, 1, stopped.stdout + stopped.stderr);
  assert.match(stopped.stdout, /NO {2}share-by-link: no run in journey-runs/);
  assert.match(stopped.stdout, /1 of 1 journeys stop the merge/);
  recordAllPassed(recorder({ outputDir: join(dir, "journey-runs") })).finish();
  const ok = spawnSync(process.execPath, [BIN, "merge-check", "journey-runs", "--main", "main-runs"], { cwd: dir, encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /ok {2}share-by-link: passed\nAll 1 journeys may merge\./);
});
