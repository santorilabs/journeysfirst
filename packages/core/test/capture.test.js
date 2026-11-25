import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { recording } from "../src/runner/recorder.js";
import { recordAllPassed, recorder } from "./helpers.js";

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
