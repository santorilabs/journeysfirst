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
const OMIT = new Set([".git", ".codex", ".mcp.json", ".aws", ".config", ".docker", ".env", ".npmrc", ".netrc", "node_modules", "journey-runs", ".journeysfirst"]);

/**
 * Run the caller's own agent command on a fresh copy of the project and save
 * what it submits as a run. Sign-in and sandboxing belong to that command.
 * @param {{journey: string, command: string, caseId?: string, project?: string, mcp?: Record<string, string[]>, timeoutMs?: number}} options
 * @returns {Promise<{folder: string, run: import("../format/runfile.js").Run, problem?: string, exitCode: number}>}
 */
export async function runAgent({ journey, command, caseId, project, mcp = {}, timeoutMs = 1800000 }) {
  const name = basename(command.trim().split(/\s+/)[0] ?? "");
  const agent = /^[\w.-]+$/.test(name) ? name : "agent";
  // Journeys First does not see inside the agent's sandbox, so the run says so.
  const run = RunRecorder.start({ journey, case: caseId, ranBy: { agent }, playedBy: { you: agent }, tags: { sandbox: "unverified" } });
  if (run.plan.everyone.some((user) => user !== "you")) {
    throw new Error("run --agent only plays the 'you' seat. Use the recorder directly for journeys with more than one user.");
  }
  const base = realpathSync(mkdtempSync(join(tmpdir(), "journeysfirst-run-")));
  const work = join(base, "work"), state = join(work, ".journeysfirst");
  let problem;
  try {
    prepareProject(project, base, work);
    if (Object.keys(mcp).length) {
      const mcpServers = Object.fromEntries(Object.entries(mcp).map(([name, argv]) => [name, {
        command: process.execPath, args: [".journeysfirst/capture.mjs", "mcp-proxy", name + ".txt", "--", ...argv],
      }]));
      writeFileSync(join(work, ".mcp.json"), JSON.stringify({ mcpServers }), { mode: 0o600 });
    }
    const result = await processResult(command, [], { cwd: work, stdin: agentPrompt(run), timeout: timeoutMs, shell: true });
    const errors = importResults(recording(run, "you"), state);
    if (errors.length) run.tag("result_import_errors", errors.map((error) => maskText(run.redact(error))));
    if (result.timedOut) problem = "The agent reached the time limit.";
    else if (result.code !== 0) problem = `The agent command exited with status ${result.code ?? "unknown"}. Check that it runs in a terminal in the project folder.`;
    if (result.stdout.trim()) run.attach({ name: "handoff.txt", body: maskText(run.redact(result.stdout)), kind: "transcript" });
  } catch (error) {
    problem = run.redact(error instanceof Error ? error.message : "The agent could not complete the journey.");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  const saved = run.finish(problem ? { attempt: { status: "aborted", reason: problem } } : undefined);
  return { ...saved, problem, exitCode: problem ? 1 : 0 };
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
  for (const [from, to] of [["capture.js", "capture.js"], ["mask.js", "mask.js"], ["codex-capture.mjs", "capture.mjs"]]) {
    copyFileSync(fileURLToPath(new URL(from, import.meta.url)), join(state, to));
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
    "If this project has .mcp.json, use it for MCP calls. Configured servers record calls as NAME.txt.",
    "Use distinct capture names. Every file in .journeysfirst/captures is a capture you can cite.",
    "As you go, write one JSON object per line to .journeysfirst/results.jsonl.",
    'Actions: {"line":1,"status":"done"}. Checks: {"id":"check-id","verdict":"passed","proof":"what you observed","refs":[{"file":"NAME.txt","line":1}]}.',
    `For a failed or blocked line include a reason and a cause: ${CAUSES.join(", ")}. A failed check also needs proof.`,
    "Do not claim a pass without a capture that proves it. Cite an output or response line, not a request line.",
    "Finish with the message you would send to the person who asked you to run the journey.",
  ].filter((line) => line !== undefined).join("\n");
}

/** @param {ReturnType<typeof recording>} seat @param {string} state */
export function importResults(seat, state) {
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
