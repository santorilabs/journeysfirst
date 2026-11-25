import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { adapters, selectAdapter } from "../src/runner/agents/index.js";
import { recording } from "../src/runner/recorder.js";
import { JOURNEY, recordAllPassed, recorder } from "./helpers.js";

const cli = fileURLToPath(new URL("../bin/journeysfirst.js", import.meta.url));
const node = process.execPath;
const dir = () => mkdtempSync(join(tmpdir(), "jf-capture-"));
const rows = (out) => readFileSync(out, "utf8").trim().split("\n").map((line) => JSON.parse(line));

test("every known agent implements the runner adapter contract", async () => {
  const files = readdirSync(new URL("../src/runner/agents/", import.meta.url)).filter((name) => name !== "index.js");
  assert.deepEqual(adapters.map(({ name }) => name + ".js").sort(), files.sort());
  for (const adapter of adapters) {
    assert.equal(selectAdapter(adapter.name), adapter);
    assert.ok(adapter.setup.trim());
    assert.equal(typeof adapter.detect(), "boolean");
    assert.equal(typeof adapter.authProbe(), "boolean");
    const base = dir(), work = join(base, "work"), state = join(work, ".journeysfirst");
    const sandbox = adapter.sandboxArgs({ work, home: join(base, "home"), auth: join(base, "auth"), node });
    assert.ok(Array.isArray(sandbox) && sandbox.every((arg) => typeof arg === "string"));
    const mcp = adapter.mcpConfig({ demo: [node, "server.js"] }, sandbox, state, work, adapter.name, node);
    assert.deepEqual(mcp.names, ["demo"]);
    assert.ok(mcp.args.some((arg) => arg.includes("mcp-proxy")));
    await assert.rejects(adapter.start({ journey: join(base, "missing.journey.yaml"), agentArgs: [] }));
  }
});

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
    + '{"jsonrpc":"2.0","id":1,"result":{"isError":true,"content":[{"type":"text","text":"Not Authorized; MCP_ADMIN_KEY=local|sample-admin-key"}]}}\r\n';
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

const fixtureSession = {
  auth_mode: "chatgpt",
  tokens: { account_id: "synthetic-account", id_token: "synthetic-id", access_token: "synthetic-access", refresh_token: "synthetic-refresh" },
};

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
assert.ok(!fs.existsSync(path.join(process.env.HOME, ".product-state")));
assert.ok(!fs.existsSync(".product-state"));
if (args[0] === "sandbox") {
  assert.match(args.join(" "), /default_permissions="journeysfirst"/);
  assert.ok(args.join(" ").includes(JSON.stringify(process.env.CODEX_HOME) + '="deny"'));
  const probe = args.at(-2);
  if (probe === auth) {
    assert.match(fs.readFileSync(probe, "utf8"), /Synthetic probe/);
    if (fs.existsSync("unsafe.txt")) process.exit(1);
  } else if (path.basename(probe) === "auth.json") {
    assert.deepEqual(JSON.parse(fs.readFileSync(probe, "utf8")), ${JSON.stringify(fixtureSession)});
    const denied = path.basename(path.dirname(probe)) === ".codex" ? path.dirname(path.dirname(probe)) : probe;
    assert.ok(args.join(" ").includes(JSON.stringify(denied) + '="deny"'));
    assert.ok(!fs.existsSync(path.join("custom-login", "auth.json")));
    if (fs.existsSync("leaky-login.txt")) process.exit(1);
  } else {
    assert.match(fs.readFileSync(probe, "utf8"), /Synthetic host home probe/);
    const host = path.dirname(path.dirname(probe));
    if (fs.existsSync("home-runtime.txt")) {
      const node = path.join(host, ".nvm/versions/node/test/bin/node");
      assert.ok(args.includes(node));
      assert.ok(args.join(" ").includes(JSON.stringify(node) + '="read"'));
      assert.ok(args.join(" ").includes(JSON.stringify(path.join(host, "bin/codex")) + '="read"'));
      assert.ok(!args.join(" ").includes(JSON.stringify(host) + '="read"'));
    } else assert.ok(args.join(" ").includes(JSON.stringify(host) + '="deny"'));
    assert.match(args.join(" "), /":minimal"="read"/);
    if (fs.existsSync("resolver-chain.txt") || fs.existsSync("resolver-alias.txt")) {
      const profile = args.find(arg => arg.startsWith("permissions.journeysfirst.filesystem="));
      const grants = profile.slice(profile.indexOf("{") + 1, -1).split(",");
      const underRun = grants.filter(entry => entry.startsWith('"/run/') || entry.startsWith('"/run"'));
      if (fs.existsSync("resolver-alias.txt")) {
        assert.ok(!grants.includes('"/etc/resolvconf/run"="read"'));
        assert.deepEqual(underRun, ['"/run/resolvconf/resolv.conf"="read"']);
      } else {
        assert.deepEqual(underRun, ['"/run/jf-resolver-link"="read"', '"/run/jf-resolver.conf"="read"']);
      }
    } else if (fs.existsSync("/etc/resolv.conf")) {
      const resolver = fs.realpathSync("/etc/resolv.conf");
      if (resolver.startsWith("/run/") && fs.statSync(resolver).isFile()) {
        assert.ok(args.join(" ").includes(JSON.stringify(resolver) + '="read"'));
        assert.ok(!args.join(" ").includes('"/run"="read"'));
      }
    }
    if (fs.existsSync("leaky-home.txt")) process.exit(1);
  }
  console.log("journeysfirst: workspace readable, auth directory denied");
} else if (args[0] === "login") {
  assert.equal(input.trim(), "synthetic-fixture-key");
  assert.ok(!fs.existsSync(auth));
  fs.writeFileSync(auth, "fake auth");
} else {
  assert.ok(args.includes("exec") && args.includes("--json") && !args.some(a => a.includes("dangerously")));
  const rotate = fs.readdirSync(".").find(name => name.startsWith("rotate-"));
  const usesExistingLogin = (rotate && rotate !== "rotate-override.txt") ||
    ["custom-login.txt", "default-login.txt", "auto-mcp.txt", "no-mcp.txt", "mcp-override.txt"].some(name => fs.existsSync(name));
  assert.equal(fs.readFileSync(auth, "utf8"), usesExistingLogin ? ${JSON.stringify(JSON.stringify(fixtureSession))} : "fake auth");
  assert.deepEqual(fs.readdirSync(process.env.CODEX_HOME), ["auth.json"]);
  if (usesExistingLogin) assert.equal(fs.statSync(auth).mode & 0o777, 0o600);
  if (rotate) {
    const changed = ${JSON.stringify(fixtureSession)};
    changed.tokens.refresh_token = "synthetic-refreshed";
    if (rotate === "rotate-other-account.txt") changed.tokens.account_id = "another-account";
    fs.writeFileSync(auth, rotate === "rotate-invalid.txt" ? "not JSON" : JSON.stringify(changed));
    if (rotate === "rotate-crash.txt") process.exit(7);
    if (["rotate-int.txt", "rotate-term.txt"].includes(rotate)) {
      fs.writeFileSync(path.join(path.dirname(auth), "..", "..", "signal-fixture.json"), JSON.stringify({ pid: process.pid, auth }));
      process.kill(process.ppid, rotate === "rotate-int.txt" ? "SIGINT" : "SIGTERM");
    }
    if (["rotate-timeout.txt", "rotate-int.txt", "rotate-term.txt"].includes(rotate)) {
      setInterval(() => {}, 500);
      return;
    }
  }
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
    if (fs.existsSync("no-mcp.txt")) {
      assert.ok(!args.some(arg => arg.startsWith("mcp_servers.")));
      return;
    }
    const server = fs.existsSync("auto-mcp.txt") ? "from_project" : "demo";
    const proxy = JSON.parse(args.find(a => a.startsWith("mcp_servers." + server + ".args=")).split("=").slice(1).join("="));
    assert.deepEqual(proxy.slice(0, 3), ["sandbox", "-P", "journeysfirst"]);
    assert.ok(proxy.includes("mcp-proxy"));
    assert.ok(proxy.some(a => a.includes(JSON.stringify(process.env.CODEX_HOME) + '="deny"')));
    assert.deepEqual(args.filter(a => a.includes("default_tools_approval_mode")), ['mcp_servers.' + server + '.default_tools_approval_mode="approve"']);
    if (server === "from_project") {
      assert.deepEqual(proxy.slice(-2), ["node", "server.js"]);
      assert.ok(proxy.includes("from_project.txt"));
    }
    assert.deepEqual(args.slice(0, 2), ["-a", "never"]);
    const cmd = spawnSync(process.execPath, [".journeysfirst/capture.mjs", "capture", "command.txt", "--",
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
  const hostHome = join(root, "host-home");
  mkdirSync(hostHome);
  const bin = join(mode === "home-runtime" ? hostHome : root, "bin");
  const project = mode === "auto-mcp" ? root : join(root, "project");
  mkdirSync(bin);
  if (project !== root) mkdirSync(project);
  mkdirSync(join(project, ".product-state"));
  writeFileSync(join(bin, "codex"), fakeCodex, { mode: 0o700 });
  const journey = mode === "multi-seat" ? JOURNEY : JOURNEY.replace("users: [viewer]\n", "");
  writeFileSync(join(root, "share-by-link.journey.yaml"), journey + "\nnotes: private setup hint\n");
  writeFileSync(join(project, ".env.local"), "Private product login");
  if (mode) writeFileSync(join(project, mode + ".txt"), "");
  const server = mode === "mcp-crash" ? [node, "-e", "process.stdin.once('data', () => process.exit(32))"] : ["node", "server.js"];
  writeFileSync(join(root, "mcp.json"), JSON.stringify({ demo: server }));
  const automatic = ["auto-mcp", "no-mcp", "auto-no-login", "mcp-override"].includes(mode ?? "");
  if (mode === "auto-mcp" || mode === "mcp-override") {
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { from_project: { command: "node", args: ["server.js"] } } }));
  }
  const selection = automatic ? mode === "mcp-override" ? ["--mcp", "mcp.json"] : [] : ["--agent", "codex", "--mcp", "mcp.json"];
  const args = mode === "auto-mcp" ? [cli, "run", "share-by-link.journey.yaml"] :
    [cli, "run", "share-by-link.journey.yaml", "--project", project, ...selection, "--timeout", ["timeout", "rotate-timeout"].includes(mode ?? "") ? "1" : "5", ...flags, "--"];
  const custom = ["custom-login", "override-login", "leaky-login"].includes(mode ?? "") || mode?.startsWith("rotate-");
  const loginDir = custom ? join(project, "custom-login") : join(hostHome, ".codex");
  if (custom || mode === "default-login" || (automatic && mode !== "auto-no-login")) {
    mkdirSync(loginDir);
    writeFileSync(join(loginDir, "auth.json"), JSON.stringify(fixtureSession), { mode: 0o640 });
    writeFileSync(join(loginDir, "config.toml"), "not part of the login");
  }
  const env = { ...process.env, TMPDIR: project === root ? tmpdir() : root, HOME: hostHome, CODEX_HOME: custom ? loginDir : "", PATH: bin + ":" + process.env.PATH, OPENAI_API_KEY: "synthetic-fixture-key" };
  if (automatic || ["custom-login", "default-login", "no-login", "leaky-login"].includes(mode ?? "") ||
      (mode?.startsWith("rotate-") && mode !== "rotate-override")) delete env.OPENAI_API_KEY;
  const resolver = mode === "resolver-chain" ? {
    links: [["/etc/resolv.conf", "/run/jf-resolver-link"], ["/run/jf-resolver-link", "jf-resolver.conf"]],
    file: "/run/jf-resolver.conf",
    dirs: [],
  } : mode === "resolver-alias" ? {
    links: [["/etc/resolv.conf", "/etc/resolvconf/run/resolv.conf"], ["/etc/resolvconf/run", "../../run/resolvconf"]],
    file: "/run/resolvconf/resolv.conf",
    dirs: ["/etc/resolvconf", "/run/resolvconf"],
  } : null;
  const preload = resolver ? ["--import", `data:text/javascript,${encodeURIComponent(`
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    const fixture = ${JSON.stringify(resolver)};
    const links = new Map(fixture.links);
    const { lstatSync, readlinkSync } = fs;
    fs.lstatSync = (path, ...args) => links.has(path) || path === fixture.file || fixture.dirs.includes(path)
      ? { isSymbolicLink: () => links.has(path), isFile: () => path === fixture.file }
      : lstatSync(path, ...args);
    fs.readlinkSync = (path, ...args) => links.get(path) ?? readlinkSync(path, ...args);
    syncBuiltinESMExports();
  `)}`] : [];
  const launchNode = mode === "home-runtime" ? join(hostHome, ".nvm/versions/node/test/bin/node") : node;
  if (mode === "home-runtime") {
    mkdirSync(join(hostHome, ".nvm/versions/node/test/bin"), { recursive: true });
    copyFileSync(realpathSync(node), launchNode);
  }
  const result = spawnSync(launchNode, [...preload, ...args], { cwd: root, env, encoding: "utf8", timeout: 10000 });
  const runs = join(root, "journey-runs", "share-by-link");
  if (!existsSync(runs)) return { result };
  const folder = join(runs, readdirSync(runs)[0]);
  return { result, folder, root, login: join(loginDir, "auth.json"), run: JSON.parse(readFileSync(join(folder, "run.json"), "utf8")) };
}

test("Codex gets the journey without hints, safe auth setup, wrapped MCP config and an evidence-backed result", () => {
  const { result, folder, run } = codexFixture();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /without a container/);
  assert.match(result.stdout, /Exit 0 means the agent finished and a run was saved\. The journey did not pass\./);
  assert.equal(run.steps[1].verdict, "passed");
  assert.equal(run.steps[1].evidence[0].login, "you");
  assert.equal(run.steps.find((step) => step.id === "viewer-blocked").verdict, "not_checked");
  assert.equal(run.result, "not_fully_checked");
  assert.equal(readFileSync(join(folder, "handoff.txt"), "utf8"), "Sharing worked. The rest was not checked.");
  assert.doesNotMatch(JSON.stringify(run), /synthetic-fixture-key|Private reasoning/);
});

test("Codex reuses only the existing login from CODEX_HOME or the default home", () => {
  for (const mode of ["custom-login", "default-login"]) {
    const { result, run } = codexFixture(mode);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(run.steps[1].verdict, "passed");
    assert.doesNotMatch(JSON.stringify(run), /synthetic-refresh/);
  }
});

test("Codex prefers an explicit API key to an existing CLI login", () => {
  const { result, run } = codexFixture("override-login");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(run.steps[1].verdict, "passed");
});

test("Codex saves a reused login's refresh after a clean exit, crash, timeout, or interrupt", () => {
  for (const [mode, status, message] of [
    ["rotate-success", 0, null],
    ["rotate-crash", 1, /exited before completing/],
    ["rotate-timeout", 1, /reached the time limit/],
    ["rotate-int", 130, /SIGINT/],
    ["rotate-term", 143, /SIGTERM/],
  ]) {
    const { result, root, login, run } = codexFixture(mode);
    assert.equal(result.status, status, result.stderr);
    if (message) assert.match(result.stderr, message);
    assert.equal(JSON.parse(readFileSync(login, "utf8")).tokens.refresh_token, "synthetic-refreshed");
    assert.equal(statSync(login).mode & 0o777, 0o640);
    if (status !== 0) assert.equal(run.attempt.status, "aborted");
    if (status === 130 || status === 143) {
      const killed = JSON.parse(readFileSync(join(root, "signal-fixture.json"), "utf8"));
      assert.throws(() => process.kill(killed.pid, 0), { code: "ESRCH" });
      assert.ok(!existsSync(killed.auth));
    }
  }
});

test("Codex does not replace the original login with invalid, different-account or override auth", () => {
  for (const mode of ["rotate-invalid", "rotate-other-account", "rotate-override"]) {
    const { result, login } = codexFixture(mode);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(login, "utf8")), fixtureSession);
  }
});

test("Codex asks for login when neither a session nor an API key is available", () => {
  const { result, run } = codexFixture("no-login");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run `codex login`/);
  assert.equal(run, undefined);
});

test("Codex stops before using an existing login if the source file is readable in the sandbox", () => {
  const { result, run } = codexFixture("leaky-login", ["--allow-host-read"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sandbox blocks the existing login file/);
  assert.equal(run.steps[1].verdict, "not_checked");
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
  assert.match(result.stderr, /failed the scratch login probe/);
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
  assert.match(result.stderr, /Codex exited before completing the journey/);
  assert.equal(run.attempt.status, "aborted");
  assert.equal(run.result, "not_fully_checked");
  assert.equal(run.steps.at(-1).verdict, "passed");
  const clean = codexFixture("complete-clean");
  assert.equal(clean.result.status, 0, clean.result.stderr);
  assert.equal(clean.run.result, "passed");
  assert.doesNotMatch(clean.result.stdout, /The journey did not pass/);
  assert.equal(clean.run.steps.at(-1).verdict, "passed");
});

test("Codex can read exactly the resolver links and file under /run", () => {
  const { result, run } = codexFixture("resolver-chain");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(run.steps[1].verdict, "passed");
});

test("run picks a signed-in adapter and records project MCP unless overridden", () => {
  for (const mode of ["auto-mcp", "mcp-override", "no-mcp"]) {
    const { result, run } = codexFixture(mode);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Using codex. Pass --agent <name> to override/);
    assert.equal(run.ran_by.agent, "codex");
  }
  const { result } = codexFixture("auto-no-login");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No signed-in agent CLI found.*Install the Codex CLI.*codex login/);
});

test("home-installed runtimes get narrow grants and still run the login and home probes", () => {
  const { result, run } = codexFixture("home-runtime");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(run.steps[1].verdict, "passed");
});

test("Codex can read the resolver through the /etc/resolvconf/run directory alias", () => {
  const { result, run } = codexFixture("resolver-alias");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(run.steps[1].verdict, "passed");
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
