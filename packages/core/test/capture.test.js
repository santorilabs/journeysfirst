import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { recording } from "../src/runner/recorder.js";
import { JOURNEY, recordAllPassed, recorder } from "./helpers.js";

const cli = fileURLToPath(new URL("../bin/journeysfirst.js", import.meta.url));
const node = process.execPath;
const dir = () => mkdtempSync(join(tmpdir(), "jf-capture-"));
const rows = (out) => readFileSync(out, "utf8").trim().split("\n").map((line) => JSON.parse(line));

test("capture keeps terminal output and exit status intact but saves a private redacted file", () => {
  const out = join(dir(), "terminal.txt");
  const code = "process.stdout.write(process.argv[1]); process.stderr.write('admin-key: sample-admin-key'); process.exitCode = 7";
  const input = "--out samples+tra[ce]";
  const cmd = [cli, "capture", "--out", out, "--secret-env", "JF_TEST_CAPTURE_SECRET", "--", node, "-e", code, "--", input];
  const result = spawnSync(node, cmd, { encoding: "utf8", env: { ...process.env, JF_TEST_CAPTURE_SECRET: "samples+tra[ce]" } });
  assert.equal(result.status, 7);
  assert.equal(result.stdout, input);
  assert.equal(result.stderr, "admin-key: sample-admin-key");
  assert.equal(statSync(out).mode & 0o777, 0o600);
  assert.deepEqual(rows(out).map((row) => row.kind), ["stdout", "stderr"]);
  assert.doesNotMatch(readFileSync(out, "utf8"), /samples|sample-admin-key/);
  assert.equal(spawnSync(node, cmd).status, 1);
});

test("large terminal output is forwarded but not saved as an unsafe partial excerpt", () => {
  const out = join(dir(), "terminal.txt");
  const result = spawnSync(node, [cli, "capture", "--out", out, "--", node, "-e", "process.stdout.write('x'.repeat(80000))"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.length, 80000);
  assert.deepEqual(rows(out), [{ kind: "notice", text: "stdout was too large to save safely." }]);
});

test("MCP proxy preserves bytes and pairs out-of-order responses without saving arguments or results", () => {
  const out = join(dir(), "mcp.txt");
  const input = '{ "jsonrpc": "2.0", "id": 1, "method":"tools/call","params":{"name":"status","arguments":{"data":"private argument"}} }\r\n'
    + '{"jsonrpc":"2.0","id":"1","method":"tools/list"}\n';
  const replies = '{"jsonrpc":"2.0","id":"1","result":{"data":"private result"}}\n'
    + '{"jsonrpc":"2.0","id":1,"result":{"isError":true,"content":[{"type":"text","text":"Not Authorized; CONVEX_ADMIN_KEY=local|sample-admin-key"}]}}\r\n';
  const server = `const blocks=[];
    process.stdin.on('data', (chunk) => blocks.push(chunk));
    process.stdin.on('end', () => {
      if (Buffer.concat(blocks).toString() !== ${JSON.stringify(input)}) throw Error('Changed input');
      const bytes = Buffer.from(${JSON.stringify(replies)});
      process.stdout.write(bytes.subarray(0, 22));
      setTimeout(() => process.stdout.write(bytes.subarray(22)), 20);
    });`;
  const result = spawnSync(node, [cli, "mcp-proxy", "--out", out, "--", node, "-e", server], { input, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, replies);
  assert.equal(result.stderr, "");
  assert.deepEqual(rows(out).map(({ kind, request }) => [kind, request]), [
    ["request", undefined], ["request", undefined], ["response", 2], ["response", 1],
  ]);
  const transcript = readFileSync(out, "utf8");
  assert.match(transcript, /tools\/call status/);
  assert.match(transcript, /Not Authorized/);
  assert.doesNotMatch(transcript, /private argument|private result|sample-admin-key/);
});

test("a seat records checks only from output lines of its own approved captures", () => {
  const root = dir();
  const out = join(root, "terminal.txt");
  const result = spawnSync(node, [cli, "capture", "--out", out, "--", node, "-e", "console.log('Link sharing: on')"]);
  assert.equal(result.status, 0);
  const run = recordAllPassed(recorder({ outputDir: root }));
  const seat = recording(run, "you");
  const file = seat.attach("terminal.txt", out, { login: "you" });
  const passed = { verdict: "passed", proof: "Read the setting." };
  assert.throws(() => seat.check("link-on", passed), /needs at least one captured evidence reference/);
  assert.throws(() => seat.check("link-on", { ...passed, refs: [{ file, line: 2 }] }), /attached to this seat/);
  assert.throws(() => recording(run, "viewer").check("link-on", { ...passed, refs: [{ file, line: 1 }] }), /attached to this seat/);
  seat.check("link-on", { ...passed, refs: [{ file, line: 1 }] });
  const { run: saved } = run.finish();
  assert.equal(saved.result, "passed");
  assert.equal(saved.steps[1].evidence[0].got, "Link sharing: on\n");
  assert.equal(saved.media[0].kind, "transcript");
});

test("admin and unknown captures cannot prove a seat's check", () => {
  const root = dir();
  const out = join(root, "mcp.txt");
  const captured = spawnSync(node, [cli, "capture", "--out", out, "--", node, "-e", "console.log('Link sharing: on')"]);
  assert.equal(captured.status, 0);
  const run = recordAllPassed(recorder({ outputDir: root }));
  const seat = recording(run, "you");
  const key = seat.attach("admin.txt", out, { key: "SERVICE_ROLE_KEY" });
  const other = seat.attach("other.txt", out, { login: "viewer" });
  const unknown = seat.attach("unknown.txt", out);
  const passed = { verdict: "passed", proof: "Read the setting." };
  for (const file of [key, other]) {
    assert.throws(() => seat.check("link-on", { ...passed, refs: [{ file, line: 1 }] }), /own session/);
  }
  assert.throws(() => seat.check("link-on", { ...passed, refs: [{ file: unknown, line: 1 }] }), /Name the session/);
  seat.check("link-on", { verdict: "failed", reason: "The app returned the wrong value.", proof: passed.proof, refs: [{ file: key, line: 1 }] });
  const { run: saved } = run.finish();
  assert.equal(saved.steps[1].evidence[0].key, "SERVICE_ROLE_KEY");
  assert.equal(saved.steps[1].evidence[0].login, undefined);
});

test("a newly declared secret in an attached capture prevents sealing the run", () => {
  const root = dir();
  const out = join(root, "terminal.txt");
  const value = "private\"fixture";
  const captured = spawnSync(node, [cli, "capture", "--out", out, "--", node, "-e", `console.log(${JSON.stringify(value)})`]);
  assert.equal(captured.status, 0);
  const run = recordAllPassed(recorder({ outputDir: root }));
  recording(run, "you").attach("terminal.txt", out);
  run.value("fixture", value, { secret: true });
  assert.throws(() => run.finish(), { message: "A declared secret is in an attached transcript. Remove it from the transcript before writing the run." });
  assert.equal(existsSync(join(root, "share-by-link")), false);
});

const fakeCodex = `#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const args = process.argv.slice(2);
const input = fs.readFileSync(0, "utf8");
const auth = path.join(process.env.CODEX_HOME, "auth.json");
assert.equal(process.env.OPENAI_API_KEY, undefined);
assert.ok(!fs.existsSync(".env.local"));
assert.ok(!fs.existsSync(path.join(process.env.HOME, ".convex")));
if (args[0] === "sandbox") {
  assert.match(args.join(" "), /default_permissions="journeysfirst"/);
  assert.ok(args.join(" ").includes(JSON.stringify(process.env.CODEX_HOME) + '="deny"'));
  assert.match(fs.readFileSync(auth, "utf8"), /Synthetic probe/);
  if (!fs.existsSync("unsafe.txt")) console.log("journeysfirst: workspace readable, auth directory denied");
} else if (args[0] === "login") {
  assert.equal(input.trim(), "synthetic-fixture-key");
  assert.ok(!fs.existsSync(auth));
  fs.writeFileSync(auth, "fake auth");
} else {
  assert.ok(args.includes("exec") && args.includes("--json") && !args.some(a => a.includes("dangerously")));
  assert.match(input, /1\\. /);
  assert.match(input, /Check link-on/);
  assert.match(input, /cause: product, test, environment/);
  assert.doesNotMatch(input, /private setup hint/);
  if (fs.existsSync("timeout.txt")) {
    fs.writeFileSync(".journeysfirst/results.jsonl", '{"line":1,"status":"done"}\\n');
    setInterval(() => {}, 500);
  } else if (fs.existsSync("failures.txt")) {
    fs.writeFileSync(".journeysfirst/results.jsonl", [
      { line: 1, status: "failed", cause: "product", reason: "The control refused the change." },
      { id: "link-on", verdict: "blocked", cause: "environment", reason: "The browser did not start." },
      { id: "viewer-blocked", verdict: "blocked", reason: "Missing cause." },
    ].map(JSON.stringify).join("\\n"));
  } else {
    assert.equal(fs.readFileSync(auth, "utf8"), "fake auth");
    const proxy = JSON.parse(args.find(a => a.startsWith("mcp_servers.demo.args=")).split("=").slice(1).join("="));
    assert.deepEqual(proxy.slice(0, 3), ["sandbox", "-P", "journeysfirst"]);
    assert.ok(proxy.includes("mcp-proxy"));
    assert.ok(proxy.some(a => a.includes(JSON.stringify(process.env.CODEX_HOME) + '="deny"')));
    assert.deepEqual(args.filter(a => a.includes("default_tools_approval_mode")), ['mcp_servers.demo.default_tools_approval_mode="approve"']);
    assert.deepEqual(args.slice(0, 2), ["-a", "never"]);
    const cmd = spawnSync(process.execPath, [".journeysfirst/codex-capture.mjs", "capture", "command.txt", "--",
      process.execPath, "-e", "console.log('Sharing is on')"], { encoding: "utf8" });
    assert.equal(cmd.status, 0);
    fs.writeFileSync(".journeysfirst/results.jsonl", [
      { line: 1, status: "done" },
      { id: "link-on", verdict: "passed", proof: "The command showed it.", refs: [{ file: "command.txt", line: 1 }] },
      { id: "viewer-blocked", verdict: "passed", proof: "No capture." },
    ].map(JSON.stringify).join("\\n"));
    console.log(JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "Private reasoning" } }));
    console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Sharing worked. The rest was not checked." } }));
  }
}
`;

function codexFixture(mode) {
  const root = dir();
  const bin = join(root, "bin");
  const project = join(root, "project");
  mkdirSync(bin);
  mkdirSync(project);
  writeFileSync(join(bin, "codex"), fakeCodex, { mode: 0o700 });
  writeFileSync(join(root, "share-by-link.journey.yaml"), JOURNEY + "\nnotes: private setup hint\n");
  writeFileSync(join(project, ".env.local"), "Private product login");
  if (mode) writeFileSync(join(project, mode + ".txt"), "");
  writeFileSync(join(root, "mcp.json"), '{"demo":["node","server.js"]}');
  const args = [cli, "run", "share-by-link.journey.yaml", "--agent", "codex", "--project", project, "--mcp", "mcp.json", "--timeout", mode === "timeout" ? "1" : "5", "--"];
  const env = { ...process.env, PATH: bin + ":" + process.env.PATH, OPENAI_API_KEY: "synthetic-fixture-key" };
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 10000 });
  const runs = join(root, "journey-runs", "share-by-link");
  const folder = join(runs, readdirSync(runs)[0]);
  return { result, folder, run: JSON.parse(readFileSync(join(folder, "run.json"), "utf8")) };
}

test("Codex gets the journey without hints, safe auth setup, wrapped MCP config and an evidence-backed result", () => {
  const { result, folder, run } = codexFixture();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /without a container/);
  assert.equal(run.steps[1].verdict, "passed");
  assert.equal(run.steps[1].evidence[0].login, "you");
  assert.equal(run.steps.find((step) => step.id === "viewer-blocked").verdict, "not_checked");
  assert.equal(run.result, "not_fully_checked");
  assert.equal(readFileSync(join(folder, "handoff.txt"), "utf8"), "Sharing worked. The rest was not checked.");
  assert.doesNotMatch(JSON.stringify(run), /synthetic-fixture-key|Private reasoning/);
});

test("timeout saves completed steps and leaves missing checks unverified", () => {
  const { result, run } = codexFixture("timeout");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /time limit/);
  assert.equal(run.steps[0].status, "done");
  assert.equal(run.steps[1].verdict, "not_checked");
  assert.equal(run.media, undefined);
});

test("a failed sandbox probe never sends the API key to login", () => {
  const { result, run } = codexFixture("unsafe");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not prove that its sandbox blocks the provider login/);
  assert.equal(run.steps[1].verdict, "not_checked");
});

test("Codex imports failure causes and records rejected result lines", () => {
  const { run } = codexFixture("failures");
  assert.equal(run.result, "failed");
  assert.equal(run.steps[0].status, "failed");
  assert.equal(run.steps[0].cause, "product");
  assert.equal(run.steps[1].verdict, "blocked");
  assert.equal(run.steps[1].cause, "environment");
  assert.match(run.tags.result_import_errors[0], /Result line 3: .*needs a cause/);
});
