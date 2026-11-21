import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DRAFT_0, JOURNEY, findings, recordAllPassed, recorder } from "./helpers.js";

const BIN = new URL("../bin/journeysfirst.js", import.meta.url).pathname;
const cli = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });

function project() {
  const dir = mkdtempSync(join(tmpdir(), "jf-cli-"));
  mkdirSync(join(dir, "journeys"));
  writeFileSync(join(dir, "journeys/share-by-link.journey.yaml"), JOURNEY);
  writeFileSync(join(dir, "journeys/old.journey.yaml"), DRAFT_0);
  writeFileSync(join(dir, "journeys/bad.journey.yaml"), JOURNEY.replace("    id: link-on\n", ""));
  return dir;
}

test("validate reads v1 and draft 0, and names the line of each problem", () => {
  const dir = project();
  const good = cli(["validate", "journeys/share-by-link.journey.yaml", "journeys/old.journey.yaml"], dir);
  assert.equal(good.status, 0, good.stdout);
  assert.match(good.stdout, /share-by-link\.journey\.yaml {2}ok {2}\(version [0-9a-f]{8}\)/);
  assert.match(good.stdout, /old\.journey\.yaml {2}ok .*draft 0/);
  const bad = cli(["validate", "journeys/bad.journey.yaml"], dir);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /line 8, step 2: the check "Link sharing is still on after a reload\." has no id/);
});

test("validate-run checks a run folder and compares its steps with the journey", () => {
  const dir = project();
  const { folder } = recordAllPassed(recorder({ outputDir: join(dir, "journey-runs") })).finish();
  const ok = cli(["validate-run", folder], dir);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /ok {2}\(passed; 3 of 3 checks passed; digest [0-9a-f]{12}\)\n {2}Steps match journeys\/share-by-link\.journey\.yaml\./);
  const wrong = cli(["validate-run", folder, "--journey", "journeys/old.journey.yaml"], dir);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stdout, /The journey changed since this run/);
  const missing = cli(["validate-run", join(dir, "nowhere")], dir);
  assert.match(missing.stdout, /is not a run folder: it has no run\.json/);
});

test("validate-run takes a journey's folder of runs and checks the newest run in it", () => {
  const dir = project();
  const runs = join(dir, "journey-runs");
  recordAllPassed(recorder({ outputDir: runs, id: "2026-11-08-1802-older000" })).finish();
  const newer = recorder({ outputDir: runs, id: "2026-11-08-1700-newer000", now: (() => { let ms = Date.parse("2026-11-09T10:00:00Z"); return () => (ms += 500); })() });
  const { folder } = recordAllPassed(newer).finish();
  const out = cli(["validate-run", "journey-runs/share-by-link"], dir);
  assert.equal(out.status, 0, out.stdout);
  assert.match(out.stdout, /^Newest run in journey-runs\/share-by-link:\n/);
  assert.ok(out.stdout.includes(`${join("journey-runs/share-by-link", "2026-11-08-1700-newer000")}  ok`), out.stdout);
  assert.ok(folder.endsWith("2026-11-08-1700-newer000"));
  const empty = cli(["validate-run", "journeys"], dir);
  assert.equal(empty.status, 1);
  assert.match(empty.stdout, /journeys is not a run folder: it has no run\.json/);
});

test("validate-run is not ok when the journey changed since the run, and says when it couldn't compare", () => {
  const dir = project();
  const { folder } = recordAllPassed(recorder({ outputDir: join(dir, "journey-runs") })).finish();
  writeFileSync(join(dir, "journeys/share-by-link.journey.yaml"), JOURNEY.replace("Turn off link sharing.", "Turn link sharing off."));
  const changed = cli(["validate-run", folder], dir);
  assert.equal(changed.status, 1);
  assert.doesNotMatch(changed.stdout, / ok /);
  assert.match(changed.stdout, /is unverified against journeys\/share-by-link\.journey\.yaml:\n- journey\.version is "[0-9a-f]{8}", but the journey file is "[0-9a-f]{8}"\. The journey changed since this run\./);

  rmSync(join(dir, "journeys/share-by-link.journey.yaml"));
  const notFound = cli(["validate-run", folder], dir);
  assert.equal(notFound.status, 0);
  assert.match(notFound.stdout, /Unverified: steps not compared with the journey, because journeys\/share-by-link\.journey\.yaml was not found\./);
});

test("validate-run counts a claimed pass with no evidence as not_checked, and says so", () => {
  const dir = project();
  const { folder, run } = recordAllPassed(recorder({ outputDir: join(dir, "journey-runs") })).finish();
  run.steps[1].evidence = [];
  writeFileSync(join(folder, "run.json"), JSON.stringify(run));
  const out = cli(["validate-run", folder], dir);
  assert.equal(out.status, 0, out.stdout);
  assert.match(out.stdout, /ok {2}\(not fully checked; 2 of 3 checks passed;/);
  assert.match(out.stdout, /Claimed passes with no evidence from the right login count as not_checked: link-on\./);
});

test("journey warnings are printed as notes and don't fail validate", () => {
  const dir = project();
  writeFileSync(join(dir, "journeys/admin.journey.yaml"), JOURNEY.replace("  - Turn off link sharing.", "  - The admin turns off link sharing."));
  const out = cli(["validate", "journeys/admin.journey.yaml"], dir);
  assert.equal(out.status, 0);
  assert.match(out.stdout, /note: line 13, step 5: this line starts with "The admin"/);
});

test("validate and validate-run refuse people: it is now called users", () => {
  const dir = project();
  writeFileSync(join(dir, "journeys/share-by-link.journey.yaml"), JOURNEY.replace("users: [viewer]", "people: [viewer]"));
  const out = cli(["validate", "journeys/share-by-link.journey.yaml"], dir);
  assert.equal(out.status, 1);
  assert.match(out.stdout, /line 4: people is now called users\. Rename it\./);

  writeFileSync(join(dir, "journeys/share-by-link.journey.yaml"), JOURNEY);
  const { folder, run } = recordAllPassed(recorder({ outputDir: join(dir, "journey-runs") })).finish();
  run.people = run.users;
  delete run.users;
  writeFileSync(join(folder, "run.json"), JSON.stringify(run));
  const checked = cli(["validate-run", folder], dir);
  assert.equal(checked.status, 1);
  assert.match(checked.stdout, /people is now called users\. Rename it\./);
});

test("add-findings writes a review's findings into the run and changes nothing else; validate-run says what the review found", () => {
  const dir = project();
  const { folder } = recordAllPassed(recorder({ outputDir: join(dir, "journey-runs") })).finish();
  const stored = () => JSON.parse(readFileSync(join(folder, "run.json"), "utf8"));
  const before = stored();
  const add = (content) => {
    writeFileSync(join(dir, "findings.json"), JSON.stringify(content));
    return cli(["add-findings", folder, "findings.json"], dir);
  };
  assert.match(cli(["validate-run", folder], dir).stdout, /\n {2}Not reviewed\.\n$/);

  const nothing = add({ findings: [] });
  assert.equal(nothing.status, 0, nothing.stderr);
  assert.match(nothing.stdout, / {2}Review: nothing found\.\n {2}The result is still passed\.\n$/);
  assert.match(cli(["validate-run", folder], dir).stdout, /\n {2}Review: nothing found\.\n$/);

  const found = add({ findings: findings() });
  assert.equal(found.status, 0, found.stderr);
  assert.match(found.stdout, / {2}Review: 1 finding, 1 question\.\n/);
  assert.deepEqual(stored(), { ...before, findings: findings() }, "only findings changed");

  const called = cli(["add-review", folder, "--on", "foundation-values-3", "--by", "ana@example.test", "--says", "Keep it."], dir);
  assert.equal(called.status, 0, called.stderr);
  assert.match(called.stdout, / {2}Review: 1 finding, 1 question, 1 seen by a person\.\n {2}The result is still passed\.\n$/);
  const { reviews, ...rest } = stored();
  assert.deepEqual(rest, { ...before, findings: findings() }, "only reviews changed");
  assert.equal(reviews.length, 1);
  assert.deepEqual({ ...reviews[0], at: "" }, { by: "ana@example.test", at: "", on: "foundation-values-3", says: "Keep it." });
  assert.ok(Date.parse(reviews[0].at) > 0, "the time is filled in");
  const checked = cli(["validate-run", folder], dir);
  assert.equal(checked.status, 0, checked.stdout);
  assert.match(checked.stdout, /\n {2}Review: 1 finding, 1 question, 1 seen by a person\.\n$/);

  const dropped = add({ findings: [] });
  assert.equal(dropped.status, 1, "a finding a person made a call on can't be dropped");
  assert.match(dropped.stderr, /^A person made a call on foundation-values-3\. Keep it in the findings file\.\n$/);
  assert.deepEqual(stored().findings, findings());
});

test("add-review refuses a call on an id the run does not have, and one with a part missing", () => {
  const dir = project();
  const { folder } = recordAllPassed(recorder({ outputDir: join(dir, "journey-runs") })).finish();
  const before = readFileSync(join(folder, "run.json"), "utf8");
  const unknown = cli(["add-review", folder, "--on", "no-such-id", "--by", "ana@example.test", "--says", "Keep it."], dir);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /review 1 is on "no-such-id", which is not a check id or a finding id in this run\./);
  const missing = cli(["add-review", folder, "--on", "link-on"], dir);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /add-review needs --by, --says\. Like: journeysfirst add-review .* --on intuitive-feedback-1 --by ana@example\.test --says "Keep it\."/);
  assert.equal(readFileSync(join(folder, "run.json"), "utf8"), before);
  const onCheck = cli(["add-review", folder, "--on", "link-on", "--by", "ana@example.test", "--says", "Confirmed."], dir);
  assert.equal(onCheck.status, 0, onCheck.stderr);
  assert.match(onCheck.stdout, /Not reviewed\./, "a call on a check is not a review against the criteria");
});

test("add-findings refuses a file that holds anything but findings, and findings that are not valid", () => {
  const dir = project();
  const { folder, run } = recordAllPassed(recorder({ outputDir: join(dir, "journey-runs") })).finish();
  const before = readFileSync(join(folder, "run.json"), "utf8");
  const add = (content) => {
    writeFileSync(join(dir, "findings.json"), JSON.stringify(content));
    return cli(["add-findings", folder, "findings.json"], dir);
  };
  const failing = structuredClone(run);
  Object.assign(failing.steps[6], { verdict: "failed", cause: "product", reason: "The link still works." });
  const edited = add({ ...failing, result: "failed", findings: findings() });
  assert.equal(edited.status, 1);
  assert.match(edited.stderr, /The findings file may hold only findings\. Remove: .*result.*steps.*\. A finding never changes a verdict or the result\./);

  const [noEvidence] = findings();
  delete noEvidence.evidence;
  const bad = add({ findings: [noEvidence] });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /would not be a valid run with these findings:\n- finding 1 \("intuitive-feedback-1"\) has no evidence: say what you measured or saw, with its url and login\./);

  assert.equal(add([]).status, 1);
  assert.match(add({}).stderr, /The findings file must be \{"findings": \[\.\.\.\]\}/);
  assert.equal(readFileSync(join(folder, "run.json"), "utf8"), before, "a refused file writes nothing");
});

/** Start a server command, wait for its first line, and stop it after. */
async function serving(args, env = {}) {
  const child = spawn(process.execPath, [BIN, ...args], { cwd: mkdtempSync(join(tmpdir(), "jf-cli-")), env: { ...process.env, ...env } });
  const [line] = await once(child.stdout, "data");
  return { line: String(line), stop: () => child.kill() };
}

async function freePort() {
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  probe.close();
  return port;
}

test("review takes --port, still reads PORT, and listens on 127.0.0.1 by default", async () => {
  const port = await freePort();
  const flagged = await serving(["review", "--port", String(port)], { PORT: "1" });
  try {
    assert.match(flagged.line, new RegExp(`http://127\\.0\\.0\\.1:${port} `));
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
  } finally {
    flagged.stop();
  }
  const other = await freePort();
  const fromEnv = await serving(["review"], { PORT: String(other) });
  try {
    assert.match(fromEnv.line, new RegExp(`http://127\\.0\\.0\\.1:${other} `));
  } finally {
    fromEnv.stop();
  }
});

test("review and dev-server listen on the --host they are given", async () => {
  for (const command of ["review", "dev-server"]) {
    const port = await freePort();
    const server = await serving([command, "--port", String(port), "--host", "localhost"]);
    try {
      assert.match(server.line, new RegExp(`http://localhost:${port}`), command);
    } finally {
      server.stop();
    }
  }
});
