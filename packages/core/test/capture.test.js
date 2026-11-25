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
  const probe = args.at(-2);
  if (probe === auth) {
    assert.match(fs.readFileSync(probe, "utf8"), /Synthetic probe/);
    if (fs.existsSync("unsafe.txt")) process.exit(1);
  } else {
    assert.match(fs.readFileSync(probe, "utf8"), /Synthetic host home probe/);
    assert.ok(args.join(" ").includes(JSON.stringify(path.dirname(path.dirname(probe))) + '="deny"'));
    assert.match(args.join(" "), /":minimal"="read"/);
    if (fs.existsSync("leaky-home.txt")) process.exit(1);
  }
  console.log("journeysfirst: workspace readable, auth directory denied");
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
  if (fs.existsSync("mcp-crash.txt")) {
    const argsJson = args.find(a => a.startsWith("mcp_servers.demo.args=")).slice("mcp_servers.demo.args=".length);
    const proxy = JSON.parse(argsJson);
    const [command, ...argv] = proxy.slice(proxy.indexOf("--") + 1);
    const child = spawnSync(command, argv, { input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "status" } }) + "\\n", encoding: "utf8" });
    assert.equal(child.status, 32);
    assert.equal(child.stdout, "");
  } else if (fs.existsSync("timeout.txt")) {
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
    const outcomes = [
      { line: 1, status: "done" },
      { id: "link-on", verdict: "passed", proof: "The command showed it.", refs: [{ file: "command.txt", line: 1 }] },
      { id: "viewer-blocked", verdict: "passed", proof: "No capture." },
    ];
    if (fs.existsSync("complete.txt") || fs.existsSync("complete-clean.txt")) {
      const [, pass] = outcomes;
      outcomes.pop();
      outcomes.push(...[3, 5, 6].map(line => ({ line, status: "done" })),
        ...["viewer-sees-it", "viewer-blocked"].map(id => ({ ...pass, id })));
      if (fs.existsSync("complete.txt")) process.exitCode = 7;
    }
    fs.writeFileSync(".journeysfirst/results.jsonl", outcomes.map(JSON.stringify).join("\\n"));
    console.log(JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "Private reasoning" } }));
    console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Sharing worked. The rest was not checked." } }));
  }
}
`;

function codexFixture(mode, flags = []) {
  const root = dir();
  const bin = join(root, "bin");
  const project = join(root, "project");
  mkdirSync(bin);
  mkdirSync(project);
  writeFileSync(join(bin, "codex"), fakeCodex, { mode: 0o700 });
  const journey = mode === "multi-seat" ? JOURNEY : JOURNEY.replace("users: [viewer]\n", "");
  writeFileSync(join(root, "share-by-link.journey.yaml"), journey + "\nnotes: private setup hint\n");
  writeFileSync(join(project, ".env.local"), "Private product login");
  if (mode) writeFileSync(join(project, mode + ".txt"), "");
  const server = mode === "mcp-crash" ? [node, "-e", "process.stdin.once('data', () => process.exit(32))"] : ["node", "server.js"];
  writeFileSync(join(root, "mcp.json"), JSON.stringify({ demo: server }));
  const args = [cli, "run", "share-by-link.journey.yaml", "--agent", "codex", "--project", project, "--mcp", "mcp.json", "--timeout", mode === "timeout" ? "1" : "5", ...flags, "--"];
  const env = { ...process.env, PATH: bin + ":" + process.env.PATH, OPENAI_API_KEY: "synthetic-fixture-key" };
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 10000 });
  const runs = join(root, "journey-runs", "share-by-link");
  if (!existsSync(runs)) return { result };
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

test("a crashed MCP server leaves an environment failure even if Codex exits cleanly", () => {
  const { result, folder, run } = codexFixture("mcp-crash");
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /MCP server "demo" exited with status 32/);
  assert.equal(run.summary, 'MCP server "demo" exited with status 32.');
  assert.deepEqual(run.tags.mcp_server_failures, [{ server: "demo", code: 32, cause: "environment" }]);
  assert.equal(run.result, "not_fully_checked");
  assert.equal(run.steps[1].verdict, "not_checked");
  assert.match(readFileSync(join(folder, "demo.txt"), "utf8"), /client tools\/call status/);
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

test("a nonzero agent exit cannot seal a passed run even with every line submitted", () => {
  const { result, run } = codexFixture("complete");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No run was saved because a passing run needs a clean exit/);
  assert.equal(run, undefined);
  const clean = codexFixture("complete-clean");
  assert.equal(clean.result.status, 0, clean.result.stderr);
  assert.equal(clean.run.result, "passed");
  assert.equal(clean.run.steps.at(-1).verdict, "passed");
});

test("the single-seat Codex launcher refuses a journey that names another seat", () => {
  const { result, run } = codexFixture("multi-seat");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /only plays the 'you' seat/);
  assert.equal(run, undefined);
});

test("host-home denial must pass the probe unless the caller opts into host reads", () => {
  const denied = codexFixture("leaky-home");
  assert.equal(denied.result.status, 1);
  assert.match(denied.result.stderr, /could not prove that its sandbox blocks your home directory/);
  assert.equal(denied.run.steps[1].verdict, "not_checked");

  const allowed = codexFixture("leaky-home", ["--allow-host-read"]);
  assert.equal(allowed.result.status, 0, allowed.result.stderr);
  assert.match(allowed.result.stderr, /Host files.*can be read/);
  assert.equal(allowed.run.steps[1].verdict, "passed");
  assert.equal(codexFixture("unsafe", ["--allow-host-read"]).result.status, 1);
});

// Built at run time so secret scanners do not read these fixtures as real keys.
const FAKE_SUBSCRIPTION_TOKEN = ["sk", "ant", "oat01", "synthetic", "fixture"].join("-");
const FAKE_API_KEY = ["sk", "ant", "api03", "org", "key"].join("-");

const fakeClaude = `#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const input = fs.readFileSync(0, "utf8");
const say = (event) => console.log(JSON.stringify(event));
const tool = (id, name, input, content, is_error = false) => {
  say({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
  say({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error }] } });
};
for (const name of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) assert.equal(process.env[name], undefined);
assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR, "3");
assert.equal(process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, "1");
assert.equal(fs.readFileSync(3, "utf8"), "${FAKE_SUBSCRIPTION_TOKEN}");
assert.ok(!fs.existsSync(".env.local") && !fs.existsSync(".claude"));
assert.ok(args.includes("-p") && args.includes("stream-json") && !args.some(a => a.includes("dangerously") || a === "bypassPermissions"));
assert.equal(args[args.indexOf("--permission-prompts") + 1], "none");
assert.ok(!args.includes("--permission-mode"));
assert.equal(args[args.indexOf("--setting-sources") + 1], "user");
const allowedTools = args[args.indexOf("--allowedTools") + 1].split(",");
assert.ok(allowedTools.includes("Bash") && !allowedTools.some(t => /^(WebFetch|Task|Agent)$/.test(t)));
const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
assert.equal(settings.sandbox.enabled, true);
assert.equal(settings.sandbox.failIfUnavailable, true);
assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
assert.ok(settings.sandbox.filesystem.denyRead.includes(process.env.CLAUDE_CONFIG_DIR));
assert.equal(settings.permissions.blockFileToolReadsOutsideWorkingDirectories, true);
const mode = ["unsafe", "read-leak", "complete", "error", "bad-login", "user-mcp", "node-off-path"].find(name => fs.existsSync(name + ".txt"));
if (mode === "bad-login") {
  say({ type: "system", subtype: "api_retry", error_status: 401, error: "authentication_failed" });
  say({ type: "result", subtype: "success", is_error: true, result: "Invalid API key" });
} else if (input.includes("setup check")) {
  const configProbe = input.match(/Read tool on (.*)/)[1];
  assert.ok(configProbe.startsWith(process.env.CLAUDE_CONFIG_DIR));
  assert.match(fs.readFileSync(".journeysfirst/probe.cjs", "utf8"), /Synthetic|probe\\.txt/);
  // Without a real sandbox the probe can read the login folder, so it must refuse to print its marker.
  const probe = mode === "unsafe" ? spawnSync("node", [".journeysfirst/probe.cjs"], { encoding: "utf8" })
    : { stdout: "journeysfirst: workspace readable, provider login hidden\\n" };
  tool("t1", "Bash", { command: "node .journeysfirst/probe.cjs" }, probe.stdout);
  tool("t2", "Read", { file_path: configProbe }, mode === "read-leak" ? fs.readFileSync(configProbe, "utf8") : "Read denied", mode !== "read-leak");
  say({ type: "result", subtype: "success", is_error: false, result: "done" });
} else {
  assert.match(input, /Check link-on/);
  assert.doesNotMatch(input, /private setup hint/);
  assert.deepEqual(settings.sandbox.network.allowedDomains, ["registry.npmjs.org"]);
  assert.ok(settings.permissions.allow.includes("mcp__demo") && allowedTools.includes("mcp__demo"));
  const server = JSON.parse(args[args.indexOf("--mcp-config") + 1]).mcpServers.demo;
  assert.equal(server.command, "env");
  assert.equal(server.args[0], "-i");
  assert.ok(server.args.includes("mcp-proxy"));
  if (mode === "user-mcp" || mode === "node-off-path") {
    // Start the server the way Claude does, with only the command and arguments from the MCP config.
    const call = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "status" } }) + "\\n";
    const child = spawnSync(server.command, server.args, { input: call, encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /"id":1/);
  } else assert.equal(server.args.at(-1), "server.js");
  assert.ok(!fs.existsSync(".journeysfirst/probe.cjs"));
  const cmd = spawnSync(process.execPath, [".journeysfirst/codex-capture.mjs", "capture", "command.txt", "--",
    process.execPath, "-e", "console.log('Sharing is on')"], { encoding: "utf8" });
  assert.equal(cmd.status, 0);
  const pass = { verdict: "passed", proof: "The command showed it.", refs: [{ file: "command.txt", line: 1 }] };
  const outcomes = [{ line: 1, status: "done" }, { id: "link-on", ...pass }];
  if (mode) outcomes.push(...[3, 5, 6].map(line => ({ line, status: "done" })), ...["viewer-sees-it", "viewer-blocked"].map(id => ({ id, ...pass })));
  fs.writeFileSync(".journeysfirst/results.jsonl", outcomes.map(JSON.stringify).join("\\n"));
  say({ type: "assistant", message: { content: [{ type: "thinking", thinking: "Private reasoning" }, { type: "text", text: "Working." }] } });
  say({ type: "result", subtype: mode === "error" ? "error_during_execution" : "success", is_error: mode === "error", result: "Sharing worked. The rest was not checked." });
}
`;

function claudeFixture(mode, { flags = [], token = FAKE_SUBSCRIPTION_TOKEN } = {}) {
  const root = dir();
  const bin = join(root, "bin");
  const project = join(root, "project");
  mkdirSync(bin);
  mkdirSync(join(project, ".claude"), { recursive: true });
  writeFileSync(join(bin, "claude"), fakeClaude, { mode: 0o700 });
  writeFileSync(join(root, "share-by-link.journey.yaml"), JOURNEY.replace("users: [viewer]\n", "") + "\nnotes: private setup hint\n");
  writeFileSync(join(project, ".env.local"), "Private product login");
  writeFileSync(join(project, ".claude", "settings.local.json"), "{}");
  if (mode) writeFileSync(join(project, mode + ".txt"), "");
  // A server installed in a user folder on PATH, like uvx in ~/.local/bin.
  const userBin = join(root, "user-bin");
  mkdirSync(userBin);
  writeFileSync(join(userBin, "user-mcp-server"), "#!/usr/bin/env node\nprocess.stdin.once('data', () => { console.log(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })); process.exit(0); });\n", { mode: 0o700 });
  writeFileSync(join(project, "server.js"), readFileSync(join(userBin, "user-mcp-server"), "utf8").split("\n").slice(1).join("\n"));
  writeFileSync(join(root, "mcp.json"), JSON.stringify({ demo: mode === "user-mcp" ? ["user-mcp-server"] : ["node", "server.js"] }));
  const args = [cli, "run", "share-by-link.journey.yaml", "--agent", "claude", "--project", project, "--mcp", "mcp.json",
    "--allow-domains", "registry.npmjs.org", "--timeout", "5", ...flags, "--"];
  // Like an IDE that starts Node by its full path: no folder on the caller's PATH has node.
  const callerPath = mode === "node-off-path"
    ? (process.env.PATH ?? "").split(":").filter((path) => !existsSync(join(path, "node"))).join(":") : process.env.PATH;
  const env = { ...process.env, PATH: [bin, callerPath, userBin].join(":"), CLAUDE_CODE_OAUTH_TOKEN: token, ANTHROPIC_API_KEY: FAKE_API_KEY };
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 10000 });
  const runs = join(root, "journey-runs", "share-by-link");
  if (!existsSync(runs)) return { result };
  const folder = join(runs, readdirSync(runs)[0]);
  return { result, folder, run: JSON.parse(readFileSync(join(folder, "run.json"), "utf8")) };
}

test("Claude gets the journey after a sandbox probe, with its subscription login on a pipe and wrapped MCP servers", () => {
  const { result, folder, run } = claudeFixture();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Claude's sandbox/);
  assert.equal(run.ran_by.agent, "claude");
  assert.equal(run.steps[1].verdict, "passed");
  assert.equal(run.steps[1].evidence[0].login, "you");
  assert.equal(run.result, "not_fully_checked");
  assert.equal(readFileSync(join(folder, "handoff.txt"), "utf8"), "Sharing worked. The rest was not checked.");
  assert.doesNotMatch(JSON.stringify(run), /synthetic-fixture|org-key|Private reasoning/);
});

test("the Claude launcher refuses an API key in place of a subscription token", () => {
  const { result, run } = claudeFixture(undefined, { token: FAKE_API_KEY });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /claude setup-token.*does not use API keys/);
  assert.equal(run, undefined);
});

test("Claude never gets the journey when its sandbox probe can read the login folder", () => {
  for (const mode of ["unsafe", "read-leak"]) {
    const { result, run } = claudeFixture(mode);
    assert.equal(result.status, 1, mode);
    assert.match(result.stderr, /could not prove that its sandbox hides the provider login/);
    assert.equal(run.steps[0].status, "not_run");
    assert.equal(run.steps[1].verdict, "not_checked");
  }
});

test("an MCP server installed in a user PATH folder starts under the proxy's clean environment", () => {
  const { result, run } = claudeFixture("user-mcp");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(run.result, "passed");
});

test("a bare node MCP server starts when node is only on the PATH the server gets", () => {
  const { result, run } = claudeFixture("node-off-path");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(run.result, "passed");
});

test("a rejected subscription token stops the Claude launcher before the journey", () => {
  const { result, run } = claudeFixture("bad-login");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not sign in with CLAUDE_CODE_OAUTH_TOKEN/);
  assert.equal(run.steps[1].verdict, "not_checked");
});

test("an error result from Claude cannot seal a passed run", () => {
  const { result, run } = claudeFixture("error");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No run was saved because a passing run needs a clean exit/);
  assert.equal(run, undefined);
  const clean = claudeFixture("complete");
  assert.equal(clean.result.status, 0, clean.result.stderr);
  assert.equal(clean.run.result, "passed");
});

test("the Claude launcher refuses Codex-only options and extra agent flags", () => {
  assert.match(claudeFixture(undefined, { flags: ["--container", "image"] }).result.stderr, /--agent codex\|claude/);
  const extra = claudeFixture(undefined, { flags: ["--", "--dangerously-skip-permissions"] });
  assert.equal(extra.result.status, 1);
  assert.match(extra.result.stderr, /Pass only --model/);
});
