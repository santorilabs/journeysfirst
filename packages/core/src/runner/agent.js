import { spawn } from "node:child_process";
import { closeSync, constants, copyFileSync, cpSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CAUSES } from "../format/runfile.js";
import { RunRecorder, recording } from "./recorder.js";
import { CAPTURE_LIMIT } from "./capture.js";
import { maskText } from "./mask.js";

// Local logins, installed packages and earlier runs stay out of the copy, so the agent starts as a new user.
const OMIT = new Set([".git", ".mcp.json", ".aws", ".config", ".docker", ".env", ".npmrc", ".netrc", "node_modules", "journey-runs", ".journeysfirst"]);
const HANDOFF_FILE = "handoff.txt";

/** @typedef {{journey: string, caseId?: string, project?: string, mcp?: Record<string, string[]>, timeoutMs?: number}} RunOptions */
/** @typedef {RunOptions & {container?: string, allowHostRead?: boolean, agentArgs: string[]}} AdapterOptions */
/** @typedef {{folder: string, run: import("../format/runfile.js").Run, problem?: string, exitCode: number}} AgentResult */
/** @typedef {{work: string, home: string, auth: string, container?: string, hostHome?: string, loginFile?: string, runtime?: string, node: string}} SandboxOptions */
/** @typedef {{name: string, setup: string, detect(container?: string): boolean, authProbe(): boolean, sandboxArgs(options: SandboxOptions): string[], mcpConfig(config: Record<string,string[]>, sandbox: string[], state: string, work: string, runtime: string, node: string): {args: string[], names: string[]}, start(options: AdapterOptions): Promise<AgentResult>}} AgentAdapter */
/** @typedef {{base: string, work: string, state: string, run: RunRecorder, signal: AbortSignal, prompt: string}} RunContext */

/** @param {RunOptions & {command: string}} options */
export async function runAgent({ command, mcp = {}, timeoutMs = 1800000, ...options }) {
  const name = basename(command.trim().split(/\s+/)[0] ?? "");
  const agent = /^[\w.-]+$/.test(name) ? name : "agent";
  return withAgentRun({ ...options, agent, label: agent, unverified: true }, async ({ work, prompt, signal }) => {
    if (Object.keys(mcp).length) {
      const mcpServers = Object.fromEntries(Object.entries(mcp).map(([name, argv]) => [name, {
        command: process.execPath, args: [".journeysfirst/capture.mjs", "mcp-proxy", name + ".txt", "--", ...argv],
      }]));
      writeFileSync(join(work, ".mcp.json"), JSON.stringify({ mcpServers }), { mode: 0o600 });
    }
    const result = await processResult(command, [], { cwd: work, stdin: prompt, timeout: timeoutMs, shell: true, signal });
    if (signal.aborted) return {};
    const problem = result.timedOut ? "The agent reached the time limit." : result.code !== 0
      ? `The agent command exited with status ${result.code ?? "unknown"}. Check that it runs in a terminal in the project folder.` : undefined;
    return { problem, handoff: result.stdout.trim() ? result.stdout : undefined };
  });
}

/**
 * @param {RunOptions & {agent: string, label: string, loginFile?: string, unverified?: boolean}} options
 * @param {(context: RunContext) => Promise<{problem?: string, handoff?: string}>} execute
 * @returns {Promise<AgentResult>}
 */
export async function withAgentRun({ journey, caseId, project, agent, label, loginFile, unverified }, execute) {
  const run = RunRecorder.start({ journey, case: caseId, ranBy: { agent }, playedBy: { you: label }, tags: unverified ? { sandbox: "unverified" } : undefined });
  if (run.plan.everyone.some((user) => user !== "you")) {
    throw new Error(`The ${label} launcher only plays the 'you' seat. Use the recorder directly for journeys with more than one user.`);
  }
  const base = realpathSync(mkdtempSync(join(tmpdir(), "journeysfirst-run-")));
  const work = join(base, "work"), state = join(work, ".journeysfirst");
  const interrupt = new AbortController();
  const onInt = () => interrupt.abort("SIGINT");
  const onTerm = () => interrupt.abort("SIGTERM");
  let problem;
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  try {
    prepareProject(project, base, work, loginFile);
    const result = await execute({ base, work, state, run, signal: interrupt.signal, prompt: agentPrompt(run) });
    const errors = importResults(recording(run, "you"), base);
    if (errors.length) run.tag("result_import_errors", errors.map((error) => maskText(run.redact(error))));
    if (result.handoff) run.attach({ name: HANDOFF_FILE, body: maskText(run.redact(result.handoff)), kind: "transcript" });
    problem = result.problem;
  } catch (error) {
    problem = run.redact(error instanceof Error ? error.message : "The agent could not complete the journey.");
  } finally {
    process.removeListener("SIGINT", onInt);
    process.removeListener("SIGTERM", onTerm);
    rmSync(base, { recursive: true, force: true });
  }
  const signal = interrupt.signal.reason;
  if (signal) problem = [`${label} was interrupted (${signal}).`, problem].filter(Boolean).join(" ");
  const saved = run.finish(problem ? { attempt: { status: "aborted", reason: problem } } : undefined);
  return { ...saved, problem, exitCode: signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : problem ? 1 : 0 };
}

/** @param {string | undefined} project @param {string} base @param {string} work @param {string} [loginFile] */
export function prepareProject(project, base, work, loginFile) {
  if (project) {
    const source = realpathSync(project);
    const inside = relative(source, base);
    if (!inside || (!inside.startsWith("../") && !isAbsolute(inside))) throw new Error("Choose a project that does not contain the scratch directory.");
    cpSync(source, work, { recursive: true, filter: (path) => {
      if (path === source) return true;
      if (path === loginFile) return false;
      const name = basename(path);
      return !OMIT.has(name) && !name.startsWith(".env.") && (!name.startsWith(".") || lstatSync(path).isFile());
    } });
  }
  const state = join(work, ".journeysfirst");
  mkdirSync(join(state, "captures"), { recursive: true });
  for (const file of ["capture.js", "mask.js", "capture.mjs"]) {
    copyFileSync(fileURLToPath(new URL(file, import.meta.url)), join(state, file));
  }
  writeFileSync(join(state, "package.json"), '{"type":"module"}\n');
}

/** @param {RunRecorder} run */
export function agentPrompt(run) {
  const start = run.journey.cases?.find((item) => item.id === run.plan.case)?.start ?? run.journey.start;
  return [
    run.journey.promise, start, "",
    ...run.plan.lines.map((line) => line.kind === "action" ? `${line.n}. ${line.says}` : `${line.n}. Check ${line.id}: ${line.check}`), "",
    "Work only in this folder. It is a fresh copy of the project, without local logins. Do not sign in to the product unless a step says to.",
    "To record selected command output, run node .journeysfirst/capture.mjs capture NAME.txt -- COMMAND ARGS.",
    "For a command that uses a service key, put --key ENV_NAME before --. Use the variable name, not its value. A key capture cannot prove a pass.",
    "If this project has .mcp.json, use it for MCP calls. Configured servers record calls as NAME.txt.",
    `Use distinct capture names other than ${HANDOFF_FILE}. Cite files from .journeysfirst/captures.`,
    "As you go, write one JSON object per line to .journeysfirst/results.jsonl.",
    'Actions: {"line":1,"status":"done"}. Checks: {"id":"check-id","verdict":"passed","proof":"what you observed","refs":[{"file":"NAME.txt","line":1}]}.',
    `For a failed or blocked line include a reason and a cause: ${CAUSES.join(", ")}. A failed check also needs proof.`,
    "Do not claim a pass without a capture that proves it. Cite an output or response line, not a request line.",
    "Finish with the message you would send to the person who asked you to run the journey.",
  ].filter((line) => line !== undefined).join("\n");
}

/** @param {ReturnType<typeof recording>} seat @param {string} base */
export function importResults(seat, base) {
  const state = join(base, "work", ".journeysfirst");
  const captures = join(state, "captures");
  if (realpathSync(captures) !== captures) throw new Error("Capture folders must stay inside the scratch project and cannot be links.");
  const output = readSmall(join(state, "results.jsonl"));
  const names = new Set(readdirSync(captures, { withFileTypes: true }).filter((item) => item.isFile() && item.name !== HANDOFF_FILE).map((item) => item.name));
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
          if (!attached.has(file)) seat.attach(file, join(captures, file), "recorded");
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
      try { seat.attach(file, join(captures, file), "recorded"); } catch {}
    }
  }
  return errors;
}

// The agent wrote this file, so a link or a huge file must not pull other data into the run.
/** @param {string} path */
export function readSmall(path) {
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

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd: string, env?: NodeJS.ProcessEnv, stdin: string, timeout: number, signal?: AbortSignal, shell?: boolean}} options
 * @returns {Promise<{code: number | null, stdout: string, timedOut: boolean}>}
 */
export function processResult(command, args, { cwd, env, stdin, timeout, signal, shell = false }) {
  return new Promise((done) => {
    if (signal?.aborted) { done({ code: null, stdout: "", timedOut: false }); return; }
    const child = spawn(command, args, { cwd, env, shell, detached: true, stdio: ["pipe", "pipe", shell ? "inherit" : "ignore"] });
    let stdout = "", timedOut = false;
    const stop = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch {} };
    signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeout);
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-2 * 1024 * 1024); });
    /** @param {number | null} code */
    const finish = (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      done({ code, stdout, timedOut });
    };
    child.once("error", () => finish(null));
    child.once("close", finish);
  });
}

/** @param {string | undefined} file @param {string} project */
export function readMcpServers(file, project) {
  const path = file ?? join(project, ".mcp.json");
  if (!file) {
    try {
      if (!lstatSync(path).isFile()) throw new Error("Use a regular .mcp.json file in the test project, or pass --mcp.");
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return {};
      throw error;
    }
  }
  const config = JSON.parse(readFileSync(path, "utf8"));
  const servers = config?.mcpServers ?? (file ? config : null);
  if (!servers || Object.getPrototypeOf(servers) !== Object.prototype) {
    throw new Error("Put an object named mcpServers in .mcp.json, or pass --mcp with server names and command arrays.");
  }
  return Object.fromEntries(Object.entries(servers).map(([name, value]) => {
    const command = Array.isArray(value) && file ? value :
      value && (!value.type || value.type === "stdio") && !value.url &&
        (!value.env || (Object.getPrototypeOf(value.env) === Object.prototype && !Object.keys(value.env).length)) &&
        Array.isArray(value.args ?? [])
        ? [value.command, ...(value.args ?? [])] : [];
    if (!/^[A-Za-z0-9][\w-]*$/.test(name) || !command.length || !command[0] || !command.every((part) => typeof part === "string")) {
      throw new Error(`MCP server "${name}" needs a stdio command and optional args, without env or a URL. Use a trusted test server.`);
    }
    return [name, command];
  }));
}
