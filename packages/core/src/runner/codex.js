import { spawn } from "node:child_process";
import { accessSync, closeSync, constants, copyFileSync, cpSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { writeRunFolder } from "../format/run-folder.js";
import { CAUSES } from "../format/runfile.js";
import { RunRecorder, recording } from "./recorder.js";
import { CAPTURE_LIMIT } from "./capture.js";
import { maskText } from "./mask.js";

const PROFILE = "journeysfirst";
const PROBE = "journeysfirst: workspace readable, auth directory denied";
const OMIT = new Set([".git", ".codex", ".convex", ".env", ".env.local", ".npmrc", ".netrc", "node_modules", "journey-runs", ".journeysfirst"]);

/**
 * Launch Codex with a fresh project and a separately protected provider login.
 * @param {{journey: string, caseId?: string, project?: string, mcp?: string, container?: string, allowHostRead?: boolean, timeoutMs?: number, agentArgs: string[]}} options
 */
export async function runCodex({ journey, caseId, project, mcp, container, allowHostRead = false, timeoutMs = 180000, agentArgs }) {
  const selected = pickArgs(agentArgs);
  const run = RunRecorder.start({ journey, case: caseId, ranBy: { agent: "codex" }, playedBy: { you: "Codex" } });
  if (run.plan.everyone.some((user) => user !== "you")) {
    throw new Error("The Codex launcher only plays the 'you' seat. Use the recorder directly for journeys with more than one user.");
  }
  const key = process.env.OPENAI_API_KEY;
  if (key) run.value("OPENAI_API_KEY", key, { secret: true });
  const base = realpathSync(mkdtempSync(join(tmpdir(), "journeysfirst-codex-")));
  const work = join(base, "work"), home = join(base, "home"), auth = join(base, "codex");
  const state = join(work, ".journeysfirst");
  const captures = join(state, "captures");
  const launcher = launcherFor({ base, work, home, auth, container });
  let problem;
  let probeDir;
  try {
    if (project) {
      const source = realpathSync(project);
      const inside = relative(source, base);
      if (!inside || (!inside.startsWith("..") && !isAbsolute(inside))) throw new Error("Choose a project that does not contain the scratch directory.");
      cpSync(source, work, { recursive: true, filter: (path) => !OMIT.has(basename(path)) && !basename(path).startsWith(".env.") });
    } else mkdirSync(work);
    mkdirSync(home);
    mkdirSync(auth);
    mkdirSync(captures, { recursive: true });
    for (const name of ["capture.js", "mask.js", "codex-capture.mjs"]) {
      copyFileSync(fileURLToPath(new URL(name, import.meta.url)), join(state, name));
    }
    writeFileSync(join(state, "package.json"), '{"type":"module"}\n');
    const hostHome = !container && !allowHostRead ? realpathSync(homedir()) : undefined;
    const permissions = profile({ work, home, auth, container, hostHome });
    const sandbox = ["sandbox", "-P", PROFILE, ...permissions];
    const probe = join(auth, "auth.json");
    writeFileSync(probe, "Synthetic probe. No login is in this file.\n");
    const checked = await launcher([...sandbox, "--", "node", "-e", probeCode(), work, probe, String(process.pid)], "", 15000);
    rmSync(probe, { force: true });
    if (checked.code !== 0 || checked.stdout.trim() !== PROBE) {
      throw new Error("Codex could not prove that its sandbox blocks the provider login. Use a compatible container or install Codex and Node outside your home directory.");
    }
    if (hostHome) {
      probeDir = mkdtempSync(join(hostHome, ".journeysfirst-probe-"));
      const canary = join(probeDir, "host.txt");
      writeFileSync(canary, "Synthetic host home probe.\n");
      const homeCheck = await launcher([...sandbox, "--", "node", "-e", probeCode(), work, canary, String(process.pid)], "", 15000);
      if (homeCheck.code !== 0 || homeCheck.stdout.trim() !== PROBE) {
        throw new Error("Codex could not prove that its sandbox blocks your home directory. Use a container or explicitly pass --allow-host-read.");
      }
    }
    if (key) {
      const login = await launcher(["login", "--with-api-key"], key + "\n", 15000);
      if (login.code !== 0) throw new Error("Codex could not sign in with OPENAI_API_KEY. Check that the provider key is valid.");
    }
    const servers = mcp ? loadServers(mcp, sandbox, state, work) : [];
    const prompt = agentPrompt(run);
    const result = await launcher(["-a", "never", ...permissions, ...servers, "exec", "--json", "--ephemeral",
      "--skip-git-repo-check", ...selected, "-"], prompt, timeoutMs);
    const seat = recording(run, "you");
    const importErrors = readResults(seat, state);
    if (importErrors.length) run.tag("result_import_errors", importErrors.map((error) => maskText(run.redact(error))));
    const final = finalMessage(result.stdout);
    if (result.timedOut) problem = "Codex reached the time limit.";
    else if (result.code !== 0) problem = "Codex exited before completing the journey.";
    if (final) run.attach({ name: "handoff.txt", body: maskText(run.redact(final)), kind: "transcript" });
  } catch (error) {
    problem = run.redact(error instanceof Error ? error.message : "Codex could not complete the journey.");
  } finally {
    if (probeDir) rmSync(probeDir, { recursive: true, force: true });
    rmSync(base, { recursive: true, force: true });
  }
  const { run: outcome, files } = run.result(problem ? { summary: problem } : undefined);
  if (problem && outcome.result === "passed") {
    throw new Error(`${problem} No run was saved because a passing run needs a clean exit.`);
  }
  const saved = writeRunFolder(run.outputDir, outcome, files, run.journey);
  return { ...saved, problem };
}

/** @param {string[]} args */
function pickArgs(args) {
  if (args.length > 2 || (args.length && (args.length !== 2 || !["--model", "-m"].includes(args[0]) || !/^[\w.-]+$/.test(args[1])))) {
    throw new Error("Pass only --model <name> after --. Journeys First sets the Codex prompt and sandbox.");
  }
  return args;
}

/** @param {RunRecorder} run */
function agentPrompt(run) {
  const start = run.journey.cases?.find((item) => item.id === run.plan.case)?.start ?? run.journey.start;
  return [
    run.journey.promise, start, "",
    ...run.plan.lines.map((line) => line.kind === "action" ? `${line.n}. ${line.says}` : `${line.n}. Check ${line.id}: ${line.check}`), "",
    "Use only the signed-out project. Do not sign in to the product.",
    "To record selected command output, run node .journeysfirst/codex-capture.mjs capture NAME.txt -- COMMAND ARGS.",
    "Use distinct capture names. Product MCP servers, when configured, save captures as NAME.txt.",
    "As you go, write one JSON object per line to .journeysfirst/results.jsonl.",
    'Actions: {"line":1,"status":"done"}. Checks: {"id":"check-id","verdict":"passed","proof":"what you observed","refs":[{"file":"NAME.txt","line":1}]}.',
    `For a failed or blocked line include a reason and a cause: ${CAUSES.join(", ")}. A failed check also needs proof.`,
    "Do not claim a pass without a capture that proves it. Cite an output or response line, not a request line.",
    "Finish with the message you would send to the person who asked you to run the journey.",
  ].filter((line) => line !== undefined).join("\n");
}

/** @param {{base: string, work: string, home: string, auth: string, container?: string}} options */
function launcherFor({ base, work, home, auth, container }) {
  const env = {
    PATH: container ? "/usr/local/bin:/usr/bin:/bin" : [dirname(process.execPath), ...(process.env.PATH ?? "").split(":")].join(":"),
    HOME: home, CODEX_HOME: auth, LANG: "C.UTF-8",
  };
  /** @param {string[]} args @param {string} stdin @param {number} timeout */
  return async (args, stdin, timeout) => {
    if (!container) return processResult("codex", args, { cwd: work, env, stdin, timeout });
    if (!/^[\w][\w./:@-]*$/.test(container)) throw new Error("Give a local container image name.");
    const name = basename(base);
    try {
      return await processResult("docker", ["run", "--pull", "never", "--rm", "--init", "-i", "--name", name,
        "--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        "--mount", `type=bind,src=${base},dst=${base}`, "--workdir", work,
        ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]), container, "codex", ...args], { cwd: work, stdin, timeout });
    } finally {
      await processResult("docker", ["rm", "-f", name], { cwd: work, stdin: "", timeout: 10000 });
    }
  };
}

/** @param {{work: string, home: string, auth: string, container?: string, hostHome?: string}} path */
function profile({ work, home, auth, container, hostHome }) {
  /** @type {Record<string, string>} */
  const paths = { [hostHome ? ":minimal" : ":root"]: "read", "/proc": "deny", [work]: "write", [home]: "write", [auth]: "deny" };
  if (hostHome) {
    for (const dir of [dirname(process.execPath), codexDirectory()]) {
      if (dir && relative(hostHome, dir).startsWith(".." + "/")) paths[dir] = "read";
    }
    paths[hostHome] = "deny";
  } else if (!container) {
    for (const name of [".aws", ".codex", ".config", ".convex", ".docker", ".gitconfig", ".kube", ".netrc", ".npmrc", ".ssh"]) {
      paths[join(homedir(), name)] = "deny";
    }
  }
  const fs = Object.entries(paths).map(([name, mode]) => `${JSON.stringify(name)}=${JSON.stringify(mode)}`).join(",");
  return ["-c", `default_permissions="${PROFILE}"`, "-c", `permissions.${PROFILE}.filesystem={${fs}}`,
    "-c", `permissions.${PROFILE}.network.enabled=true`, "-c", 'shell_environment_policy.inherit="none"',
    "-c", `shell_environment_policy.set={HOME=${JSON.stringify(home)},PATH=${JSON.stringify(container ? "/usr/local/bin:/usr/bin:/bin" : dirname(process.execPath) + ":/usr/local/bin:/usr/bin:/bin")}}`];
}

function codexDirectory() {
  for (const path of (process.env.PATH ?? "").split(":")) {
    if (!isAbsolute(path)) continue;
    try {
      const executable = realpathSync(join(path, "codex"));
      accessSync(executable, constants.X_OK);
      return dirname(executable);
    } catch {}
  }
}

function probeCode() {
  return `const fs=require("node:fs");
    fs.readdirSync(process.argv[1]);
    const outer = "/proc/" + process.argv[3];
    for (const path of [process.argv[2], outer + "/environ", outer + "/root" + process.argv[2]]) {
      try { fs.readFileSync(path); process.exit(1); }
      catch(e) { if (!["EACCES","EPERM","ENOENT"].includes(e.code)) throw e; }
    }
    console.log(${JSON.stringify(PROBE)});`;
}

/** @param {string} file @param {string[]} sandbox @param {string} state @param {string} work */
function loadServers(file, sandbox, state, work) {
  const config = JSON.parse(readFileSync(file, "utf8"));
  if (!config || Object.getPrototypeOf(config) !== Object.prototype) throw new Error("Give --mcp a JSON object of server names and command arrays.");
  return Object.entries(config).flatMap(([name, argv]) => {
    if (!/^[\w-]+$/.test(name) || !Array.isArray(argv) || !argv.length || !argv.every((item) => typeof item === "string")) {
      throw new Error("Each MCP server needs a plain name and an array of command words.");
    }
    const args = [...sandbox, "--", "node", join(state, "codex-capture.mjs"), "mcp-proxy", name + ".txt", "--", ...argv];
    const prefix = `mcp_servers.${name}`;
    return ["-c", `${prefix}.command="codex"`, "-c", `${prefix}.args=${JSON.stringify(args)}`,
      "-c", `${prefix}.cwd=${JSON.stringify(work)}`, "-c", `${prefix}.default_tools_approval_mode="approve"`];
  });
}

/** @param {ReturnType<typeof recording>} seat @param {string} state */
function readResults(seat, state) {
  const output = readSmall(join(state, "results.jsonl"));
  const names = new Set(readdirSync(join(state, "captures"), { withFileTypes: true }).filter((item) => item.isFile()).map((item) => item.name));
  const attached = new Set();
  const errors = [];
  for (const [index, line] of output.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.line && ["done", "failed", "blocked", "not_run"].includes(entry.status)) {
        seat.step(entry.line, { status: entry.status, reason: entry.reason, cause: entry.cause });
      } else if (entry.id && ["passed", "failed", "blocked", "not_checked"].includes(entry.verdict)) {
        const refs = Array.isArray(entry.refs) ? entry.refs : [];
        for (const { file } of refs) {
          if (!names.has(file)) continue;
          if (!attached.has(file)) seat.attach(file, join(state, "captures", file), { login: "you" });
          attached.add(file);
        }
        seat.check(entry.id, { verdict: entry.verdict, proof: entry.proof, reason: entry.reason, cause: entry.cause, refs });
      } else throw new Error("Give an action line and status, or a check id and verdict.");
    } catch (error) {
      const message = error instanceof SyntaxError ? "Not a JSON object." : error instanceof Error ? error.message : "Invalid result.";
      errors.push(`Result line ${index + 1}: ${message}`);
    }
  }
  for (const file of names) {
    if (!attached.has(file)) {
      try { seat.attach(file, join(state, "captures", file)); } catch {}
    }
  }
  return errors;
}

/** @param {string} path */
function readSmall(path) {
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!fstatSync(fd).isFile()) return "";
      const buf = Buffer.alloc(CAPTURE_LIMIT + 1);
      let offset = 0;
      while (offset < buf.length) {
        const read = readSync(fd, buf, offset, buf.length - offset, null);
        if (!read) break;
        offset += read;
      }
      const text = buf.toString("utf8", 0, Math.min(offset, CAPTURE_LIMIT));
      return offset > CAPTURE_LIMIT ? text.slice(0, text.lastIndexOf("\n") + 1) : text;
    } finally { closeSync(fd); }
  } catch { return ""; }
}

/** @param {string} text */
function finalMessage(text) {
  let final = "";
  for (const line of text.split("\n")) {
    try {
      const event = JSON.parse(line);
      if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
        final = event.item.text;
      }
    } catch {}
  }
  return final;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd: string, env?: NodeJS.ProcessEnv, stdin: string, timeout: number}} options
 * @returns {Promise<{code: number | null, stdout: string, timedOut: boolean}>}
 */
function processResult(command, args, { cwd, env, stdin, timeout }) {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "", timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch {}
    }, timeout);
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-2 * 1024 * 1024); });
    child.once("error", () => { clearTimeout(timer); done({ code: null, stdout, timedOut }); });
    child.once("close", (code) => { clearTimeout(timer); done({ code, stdout, timedOut }); });
  });
}
