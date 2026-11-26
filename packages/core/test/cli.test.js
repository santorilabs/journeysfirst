import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RunRecorder } from "../src/runner/recorder.js";
import { recording } from "../src/runner/recording.js";
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
  assert.match(cli(["validate-run", folder], dir).stdout, /\n {2}Not reviewed\.\n {2}Follow journey-review, then run: npx journeysfirst add-findings <run folder> <findings file>\n$/);

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

// A stand-in for any agent CLI: it reads the journey on stdin, records a capture and submits results.
const fakeAgent = `
import { spawnSync } from "node:child_process";
import fs from "node:fs";
const prompt = fs.readFileSync(0, "utf8");
if (fs.existsSync(".mcp.json")) {
  const { command, args } = JSON.parse(fs.readFileSync(".mcp.json", "utf8")).mcpServers.example;
  const input = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "status" } }) + "\\n";
  const proxy = spawnSync(command, args, { input, encoding: "utf8" });
  if (proxy.status !== 0 || !fs.readFileSync(".journeysfirst/captures/example.txt", "utf8").includes("client tools/call status")) process.exit(8);
}
const capture = spawnSync(process.execPath, [".journeysfirst/capture.mjs", "capture", "command.txt", "--",
  process.execPath, "-e", "console.log('Sharing is on')"], { encoding: "utf8" });
if (capture.status !== 0) process.exit(9);
const results = [{ line: 1, status: "done" }];
if (prompt.includes("Check link-on: Link sharing is still on after a reload.")) {
  results.push({ id: "link-on", verdict: "passed", proof: "The command showed it.", refs: [{ file: "command.txt", line: 1 }] });
}
fs.writeFileSync(".journeysfirst/results.jsonl", results.map((r) => JSON.stringify(r)).join("\\n"));
console.log(prompt.split("\\n")[0]);
console.log("login " + (process.env.JF_TEST_AGENT_LOGIN ?? "missing") + ", env file " + (fs.existsSync(".env.local") ? "copied" : "left out"));
process.exitCode = Number(process.argv[2] ?? 0);
`;

function agentRun(extra = [], exitCode = 0, script = fakeAgent) {
  const dir = mkdtempSync(join(tmpdir(), "jf-agent-"));
  mkdirSync(join(dir, "project"));
  writeFileSync(join(dir, "project", ".env.local"), "Private product login");
  writeFileSync(join(dir, "project", ".mcp.json"), JSON.stringify({ mcpServers: {
    example: { command: process.execPath, args: ["-e", "process.stdin.once('data', () => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:1,result:{}})+'\\n'))"] },
  } }));
  writeFileSync(join(dir, "agent.mjs"), script);
  writeFileSync(join(dir, "share.journey.yaml"), JOURNEY.replace("users: [viewer]\n", ""));
  const command = `node ${JSON.stringify(join(dir, "agent.mjs"))} ${exitCode}`;
  const result = spawnSync(process.execPath, [BIN, "run", "share.journey.yaml", "--agent", command, "--project", "project", ...extra],
    { cwd: dir, encoding: "utf8", env: { ...process.env, JF_TEST_AGENT_LOGIN: "kept" } });
  const runs = join(dir, "journey-runs", "share");
  let folder;
  try { folder = join(runs, readdirSync(runs)[0]); } catch { return { result }; }
  return { result, folder, run: JSON.parse(readFileSync(join(folder, "run.json"), "utf8")) };
}

test("run --agent gives any agent command the journey on stdin and saves what it submits", () => {
  const { result, folder, run } = agentRun();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Saved not_fully_checked run to /);
  assert.equal(run.steps[0].status, "done");
  assert.equal(run.steps[1].verdict, "passed");
  assert.equal(run.steps[1].evidence[0].login, "you");
  assert.equal(run.result, "not_fully_checked");
  assert.equal(run.attempt, undefined);
  assert.deepEqual(run.ran_by, { agent: "node" });
  assert.equal(run.tags.sandbox, "unverified");
  const handoff = readFileSync(join(folder, "handoff.txt"), "utf8");
  assert.match(handoff, /^You can share a presentation by link/);
  assert.match(handoff, /login kept, env file left out/);
  assert.equal(cli(["validate-run", folder, "--journey", join(folder, "../../../share.journey.yaml")]).status, 0);
});

test("run --agent saves an aborted attempt when the agent exits with an error, so it cannot pass", () => {
  const { result, run } = agentRun([], 3);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exited with status 3/);
  assert.equal(run.steps[1].verdict, "passed");
  assert.equal(run.attempt.status, "aborted");
  assert.equal(run.result, "not_fully_checked");
});

test("a custom agent cannot use a service-key capture as its own evidence for a pass", () => {
  const script = fakeAgent.replace('"command.txt", "--"', '"command.txt", "--key", "SERVICE_ROLE_KEY", "--"');
  const { result, run, folder } = agentRun([], 0, script);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(run.steps[1].verdict, "not_checked");
  assert.match(run.tags.result_import_errors[0], /this seat's own session/);
  assert.equal(JSON.parse(readFileSync(join(folder, "command.txt"), "utf8").trim()).key, "SERVICE_ROLE_KEY");
});

test("the final handoff cannot overwrite cited evidence", () => {
  const { result, run, folder } = agentRun([], 0, fakeAgent.replaceAll("command.txt", "handoff.txt"));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(run.steps[1].verdict, "not_checked");
  assert.match(run.tags.result_import_errors[0], /capture attached to this seat/);
  assert.match(readFileSync(join(folder, "handoff.txt"), "utf8"), /^You can share a presentation by link/);
});

test("interrupting a custom agent stops its process and saves an aborted attempt", async () => {
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    const dir = mkdtempSync(join(tmpdir(), "jf-agent-interrupt-"));
    mkdirSync(join(dir, "journeys"));
    const journey = join(dir, "journeys", "share.journey.yaml");
    const runs = join(dir, "journey-runs");
    writeFileSync(journey, JOURNEY.replace("users: [viewer]\n", ""));
    const agent = join(dir, "agent.mjs");
    writeFileSync(agent, `import fs from "node:fs";
      fs.readFileSync(0);
      fs.writeFileSync(${JSON.stringify(join(dir, "agent-state.json"))}, JSON.stringify({ pid: process.pid, scratch: process.cwd() }));
      process.kill(process.ppid, ${JSON.stringify(signal)});
      setTimeout(() => {}, 3000);`);
    const older = RunRecorder.start({ journey, outputDir: runs, id: "2026-11-08-1802-older000" });
    for (const line of older.plan.lines) {
      if (line.kind === "action") older.step(line.n, { by: "you" });
      else older.check(line.id, { by: "you", verdict: "passed", proof: "Saw the expected state.", evidence: [
        { source: "log", login: "you", query: "status", got: "Expected state." },
      ] });
    }
    assert.equal(older.finish().run.result, "passed");
    assert.equal(cli(["merge-check", runs], dir).status, 0);
    const child = spawn(process.execPath, [BIN, "run", journey, "--agent", `exec "${process.execPath}" "${agent}"`], { cwd: dir });
    assert.deepEqual(await once(child, "exit"), [code, null]);
    const { pid, scratch } = JSON.parse(readFileSync(join(dir, "agent-state.json"), "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    assert.throws(() => readFileSync(join(scratch, ".journeysfirst", "package.json")), { code: "ENOENT" });
    const folders = readdirSync(join(runs, "share")).filter((name) => !name.endsWith("older000"));
    assert.equal(folders.length, 1);
    const run = JSON.parse(readFileSync(join(runs, "share", folders[0], "run.json"), "utf8"));
    assert.equal(run.attempt.status, "aborted");
    assert.match(run.attempt.reason, new RegExp(signal));
    const merged = cli(["merge-check", runs], dir);
    assert.equal(merged.status, 1);
    assert.match(merged.stdout, /aborted/i);
  }
});

test("run --agent refuses options it does not use", () => {
  for (const extra of [["--container", "image"], ["--allow-host-read"], ["--", "--model", "x"]]) {
    const { result, run } = agentRun(extra);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--agent "<command>"/);
    assert.equal(run, undefined);
  }
});

test("a known agent proxies native stdio servers and honors project and explicit overrides", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-native-mcp-"));
  const home = join(dir, "home"), bin = join(dir, "bin"), project = join(dir, "project");
  for (const path of [home, bin, project]) mkdirSync(path);
  const auth = join(home, "native-config"), observed = join(dir, "observed.json");
  mkdirSync(auth);
  writeFileSync(join(auth, "auth.json"), "{}");
  writeFileSync(join(auth, "config.toml"), [
    "[mcp_servers.native]", "command = 'npx'", "args = [", '  "--yes", # comment', "  'example#fixture',", "\"mcp\",", "]",
    'env_vars = ["TEST_API_KEY"]', "[mcp_servers.shared]", 'command = "native-shared"',
    "[mcp_servers.disabled]", "enabled = false", 'command = "disabled"',
    "[mcp_servers.remote]", 'url = "https://example.invalid"',
  ].join("\n"));
  writeFileSync(join(bin, "codex"), `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "sandbox") console.log("journeysfirst: workspace readable, auth directory denied");
else {
const preflightPath = ".journeysfirst/captures/launcher-preflight.txt";
const preflight = fs.readFileSync(preflightPath, "utf8");
fs.writeFileSync(preflightPath, "Forged launcher evidence");
const outcome = (id, line) => ({ id, verdict: "passed", proof: "Read launcher preflight.", refs: [{ file: "launcher-preflight.txt", line }] });
fs.writeFileSync(".journeysfirst/results.jsonl", [
  outcome("link-on", 3), outcome("launcher-login", 3), outcome("launcher-protected", 2),
].map(JSON.stringify).join("\\n"));
const echoed = ["CI", "FIXTURE_SHORT", "FIXTURE_LONG"].map((name) => process.env["JF_MCP_ENV_" + name]).filter(Boolean);
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Evidence: " + path.resolve(preflightPath) + (echoed.length ? "; server returned " + echoed.join(", ") : "") } }));
fs.writeFileSync(${JSON.stringify(observed)}, JSON.stringify({
  args, named: Boolean(process.env.JF_MCP_ENV_TEST_API_KEY),
  leaked: Boolean(process.env.TEST_API_KEY || process.env.JF_MCP_ENV_NOT_REQUESTED || process.env.NOT_REQUESTED),
  copied: fs.existsSync(process.env.CODEX_HOME + "/config.toml"),
  preflight,
}));
}`, { mode: 0o700 });
  writeFileSync(join(dir, "share.journey.yaml"), JOURNEY.replace("users: [viewer]\n", "") +
    "  - check: You see the launcher reuse its login.\n    id: launcher-login\n    launcher_probe: login-reuse\n" +
    "  - check: You see the launcher verify protected files.\n    id: launcher-protected\n    launcher_probe: protected-files\n");
  const { OPENAI_API_KEY, ...hostEnv } = process.env;
  const env = { ...hostEnv, HOME: home, CODEX_HOME: auth, TMPDIR: dir, PATH: bin + ":" + process.env.PATH,
    TEST_API_KEY: "named-test-value", NOT_REQUESTED: "unselected-test-value", CI: "1", FIXTURE_SHORT: "qZ7x", FIXTURE_LONG: "wX3zRt7Y" };
  const run = (...extra) => {
    const result = spawnSync(process.execPath, [BIN, "run", "share.journey.yaml", "--project", project, ...extra], { cwd: dir, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Next: npx journeysfirst validate-run .*\nThen follow journey-review\./);
    const folder = /^Saved .* run to (.+)\.$/m.exec(result.stdout)[1];
    return { ...JSON.parse(readFileSync(observed, "utf8")), stderr: result.stderr, folder: join(dir, folder) };
  };
  const native = run();
  assert.match(native.stderr, /Proxying MCP servers from agent config\.toml: native/);
  const saved = JSON.parse(readFileSync(join(native.folder, "run.json"), "utf8"));
  const check = (id) => saved.steps.find((step) => step.id === id);
  assert.equal(check("link-on").verdict, "not_checked");
  assert.match(saved.tags.result_import_errors[0], /only for its declared probe/);
  for (const [id, probe] of [["launcher-login", "login-reuse"], ["launcher-protected", "protected-files"]]) {
    assert.equal(check(id).verdict, "passed");
    assert.deepEqual({ ...check(id).evidence[0], got: undefined, query: undefined },
      { source: "launcher", probe, got: undefined, query: undefined });
  }
  assert.match(check("launcher-login").evidence[0].got, /reused the existing CLI login/);
  const preflight = readFileSync(join(native.folder, "launcher-preflight.txt"), "utf8");
  assert.equal(readFileSync(join(native.folder, "handoff.txt"), "utf8"), "Evidence: launcher-preflight.txt");
  assert.equal(preflight, native.preflight);
  assert.match(preflight, /could not read a test file in the host home directory/);
  assert.match(preflight, /the existing CLI login file, or the scratch login file/);
  const proxy = JSON.parse(native.args.find((arg) => arg.startsWith("mcp_servers.native.args=")).split(/=(.*)/s)[1]);
  assert.deepEqual(proxy.slice(-9), ["mcp-proxy", "native.txt", "--env-vars", "TEST_API_KEY", "--", "npx", "--yes", "example#fixture", "mcp"]);
  assert.ok(native.args.includes('mcp_servers.native.env_vars=["JF_MCP_ENV_TEST_API_KEY"]'));
  assert.equal(native.named, true);
  assert.equal(native.leaked || native.copied, false);
  assert.doesNotMatch(native.args.join(" "), /disabled|remote|named-test-value/);
  writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { shared: { command: "project-shared" } } }));
  const projectAndNative = run();
  assert.match(projectAndNative.stderr, /Proxying MCP servers from \.mcp\.json: shared/);
  const merged = projectAndNative.args.join(" ");
  assert.match(merged, /mcp_servers.native.args=.*project-shared/);
  assert.doesNotMatch(merged, /native-shared/);
  writeFileSync(join(dir, "override.json"), JSON.stringify({ only: ["explicit"] }));
  const only = run("--mcp", "override.json");
  assert.match(only.stderr, /Proxying MCP servers from --mcp: only\./);
  assert.match(only.args.join(" "), /mcp_servers.only.args=.*explicit/);
  assert.doesNotMatch(only.args.join(" "), /mcp_servers\.(native|shared)/);
  assert.equal(only.named, false);
  writeFileSync(join(auth, "config.toml"), '[mcp_servers.user_fixture]\ncommand = "npx"\nenv_vars = ["TEST_API_KEY"]\njourneysfirst_login = true\n');
  const user = run().args.find((arg) => arg.startsWith("mcp_servers.user_fixture.args="));
  assert.match(user, /"--login-env-vars","TEST_API_KEY"/);
  writeFileSync(join(auth, "config.toml"), '[mcp_servers.ci_fixture]\ncommand = "npx"\nenv_vars = ["CI", "FIXTURE_SHORT", "FIXTURE_LONG"]\n');
  const ci = run();
  assert.ok(ci.args.includes('mcp_servers.ci_fixture.env_vars=["JF_MCP_ENV_CI","JF_MCP_ENV_FIXTURE_SHORT","JF_MCP_ENV_FIXTURE_LONG"]'));
  const handoff = readFileSync(join(ci.folder, "handoff.txt"), "utf8");
  assert.match(handoff, /server returned 1, •+, •+/);
  assert.doesNotMatch(handoff, /qZ7x|wX3zRt7Y/);
  for (const setting of ['"disabled_tools" = ["write"]', "'enabled_tools' = ['read']", 'env = { FIXTURE = "not-used" }']) {
    writeFileSync(join(auth, "config.toml"), `[mcp_servers.restricted]\ncommand = "npx"\n${setting}\n`);
    const restricted = spawnSync(process.execPath, [BIN, "run", "share.journey.yaml", "--project", project], { cwd: dir, env, encoding: "utf8" });
    assert.equal(restricted.status, 0, restricted.stderr);
    assert.match(restricted.stderr, /Skipping MCP server "restricted".*inline environment values or tool restrictions/);
    const args = JSON.parse(readFileSync(observed, "utf8")).args.join(" ");
    assert.match(args, /mcp_servers.shared.args=.*project-shared/);
    assert.doesNotMatch(args, /mcp_servers\.restricted/);
  }
});

test("run warns when a journey has no MCP server and the handoff contradicts the saved checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-run-warnings-"));
  writeFileSync(join(dir, "share.journey.yaml"), JOURNEY.replace("users: [viewer]\n", "").replace(/^promise:.*$/m, "promise: Call my MCP server"));
  const result = cli(["run", "share.journey.yaml", "--agent", "echo All checks passed"], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /mentions MCP or tools, but no MCP server is configured/);
  assert.match(result.stderr, /claims in handoff\.txt against the saved run.*not checked: link-on/);
});

test("forwarded MCP credentials prove a pass only when marked as the user's login", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-delegated-mcp-"));
  mkdirSync(join(dir, "captures"));
  for (const file of ["capture.mjs", "capture.js", "mask.js"]) {
    copyFileSync(new URL("../src/runner/" + file, import.meta.url), join(dir, file));
  }
  const request = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "status" } };
  const reply = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Link sharing: on" }] } };
  const server = `process.stdin.on("end", () => console.log(${JSON.stringify(JSON.stringify(reply))})); process.stdin.resume();`;
  for (const [flag, name, credential, ownLogin] of [
    ["--env-vars", "admin.txt", "ADMIN_CREDENTIAL", false],
    ["--env-vars", "empty.txt", "EMPTY_VAR", false],
    ["--login-env-vars", "user.txt", "USER_TOKEN", true],
  ]) {
    const result = spawnSync(process.execPath, [join(dir, "capture.mjs"), "mcp-proxy", name,
      flag, credential, "--", process.execPath, "-e", server], {
      input: JSON.stringify(request) + "\n", encoding: "utf8",
      env: { ...process.env, ["JF_MCP_ENV_" + credential]: name === "empty.txt" ? "" : "fixture-credential" }, timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    const run = recordAllPassed(recorder({ outputDir: dir }));
    const seat = recording(run, "you");
    const capturePath = join(dir, "captures", name);
    const file = seat.attach(name, capturePath, "recorded");
    const first = JSON.parse(readFileSync(capturePath, "utf8").split("\n")[0]);
    const recordPass = () => seat.check("link-on", { verdict: "passed", proof: "Read the setting.", refs: [{ file, line: 2 }] });
    if (ownLogin) {
      assert.equal(first.login, "you");
      recordPass();
      assert.equal(run.finish().run.steps[1].evidence[0].login, "you");
    } else {
      assert.equal(first.key, credential);
      assert.throws(recordPass, /own session/);
    }
  }
});

test("proxied MCP captures keep ordinary one-character forwarded values and mask longer ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-forwarded-redaction-"));
  try {
    mkdirSync(join(dir, "captures"));
    for (const file of ["capture.mjs", "capture.js", "mask.js"]) {
      copyFileSync(new URL("../src/runner/" + file, import.meta.url), join(dir, file));
    }
    const server = `process.stdin.on("end", () => {
      const text = [process.env.CI, process.env.SHORT, process.env.LONG].join(", ");
      console.log(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } }));
    }); process.stdin.resume();`;
    const result = spawnSync(process.execPath, [join(dir, "capture.mjs"), "mcp-proxy", "server.txt",
      "--env-vars", "CI,SHORT,LONG", "--", process.execPath, "-e", server], {
      input: '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fixture"}}\n', encoding: "utf8",
      env: { ...process.env, JF_MCP_ENV_CI: "1", JF_MCP_ENV_SHORT: "qZ7x", JF_MCP_ENV_LONG: "wX3zRt7Y" }, timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    const text = readFileSync(join(dir, "captures/server.txt"), "utf8");
    assert.match(text, /1, •+, •+/);
    assert.doesNotMatch(text, /qZ7x|wX3zRt7Y/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a relative npm archive outside the project installs from its scratch copy", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-run-archive-"));
  try {
    const project = join(dir, "project"), fixture = join(dir, "fixture");
    mkdirSync(project);
    mkdirSync(fixture);
    writeFileSync(join(fixture, "package.json"), JSON.stringify({ name: "fixture-dep", version: "1.0.0", main: "index.js" }));
    writeFileSync(join(fixture, "index.js"), "module.exports = 'installed fixture';\n");
    const npm = (...args) => spawnSync("npm", args, { cwd: dir, encoding: "utf8", timeout: 30000 });
    const packed = npm("pack", fixture, "--ignore-scripts", "--pack-destination", dir);
    assert.equal(packed.status, 0, packed.stderr);
    const manifest = join(project, "package.json");
    writeFileSync(manifest, JSON.stringify({ dependencies: { "fixture-dep": "file:../fixture-dep-1.0.0.tgz" } }));
    const installed = npm("--prefix", project, "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund");
    assert.equal(installed.status, 0, installed.stderr);
    writeFileSync(join(dir, "share.journey.yaml"), JOURNEY.replace("users: [viewer]\n", ""));
    const command = `npm ci --ignore-scripts --no-audit --no-fund && node -p 'require("fixture-dep")'`;
    const result = cli(["run", "share.journey.yaml", "--project", project, "--agent", command], dir);
    assert.equal(result.status, 0, result.stderr);
    const runDir = join(dir, "journey-runs", "share");
    assert.match(readFileSync(join(runDir, readdirSync(runDir)[0], "handoff.txt"), "utf8"), /installed fixture/);
    assert.equal(JSON.parse(readFileSync(manifest, "utf8")).dependencies["fixture-dep"], "file:../fixture-dep-1.0.0.tgz");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
