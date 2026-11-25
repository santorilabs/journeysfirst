import { spawn } from "node:child_process";
import { closeSync, constants, copyFileSync, cpSync, fstatSync, mkdirSync, mkdtempSync, openSync, readSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CAUSES } from "../format/runfile.js";
import { RunRecorder, recording } from "./recorder.js";
import { CAPTURE_LIMIT } from "./capture.js";
import { maskText } from "./mask.js";

// Local logins, installed packages and earlier runs stay out of the copy, so the agent starts as a new user.
const OMIT = new Set([".git", ".env", ".npmrc", ".netrc", "node_modules", "journey-runs", ".journeysfirst"]);

/**
 * Run the caller's own agent command on a fresh copy of the project and save
 * what it submits as a run. Sign-in and sandboxing belong to that command.
 * @param {{journey: string, command: string, caseId?: string, project?: string, timeoutMs?: number}} options
 * @returns {Promise<{folder: string, run: import("../format/runfile.js").Run, problem?: string}>}
 */
export async function runAgent({ journey, command, caseId, project, timeoutMs = 1800000 }) {
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
    if (project) {
      const source = realpathSync(project);
      const inside = relative(source, base);
      if (!inside || (!inside.startsWith("..") && !isAbsolute(inside))) throw new Error("Choose a project that does not contain the scratch directory.");
      cpSync(source, work, { recursive: true, filter: (path) => !OMIT.has(basename(path)) && !basename(path).startsWith(".env.") });
    }
    mkdirSync(join(state, "captures"), { recursive: true });
    for (const [from, to] of [["capture.js", "capture.js"], ["mask.js", "mask.js"], ["codex-capture.mjs", "capture.mjs"]]) {
      copyFileSync(fileURLToPath(new URL(from, import.meta.url)), join(state, to));
    }
    writeFileSync(join(state, "package.json"), '{"type":"module"}\n');
    const result = await shellResult(command, { cwd: work, stdin: agentPrompt(run), timeout: timeoutMs });
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
  return { ...saved, problem };
}

/** @param {RunRecorder} run */
function agentPrompt(run) {
  const start = run.journey.cases?.find((item) => item.id === run.plan.case)?.start ?? run.journey.start;
  return [
    run.journey.promise, start, "",
    ...run.plan.lines.map((line) => line.kind === "action" ? `${line.n}. ${line.says}` : `${line.n}. Check ${line.id}: ${line.check}`), "",
    "Work only in this folder. It is a fresh copy of the project, without local logins. Do not sign in to the product unless a step says to.",
    "To record selected command output, run node .journeysfirst/capture.mjs capture NAME.txt -- COMMAND ARGS.",
    "Use distinct capture names. Every file in .journeysfirst/captures is a capture you can cite.",
    "As you go, write one JSON object per line to .journeysfirst/results.jsonl.",
    'Actions: {"line":1,"status":"done"}. Checks: {"id":"check-id","verdict":"passed","proof":"what you observed","refs":[{"file":"NAME.txt","line":1}]}.',
    `For a failed or blocked line include a reason and a cause: ${CAUSES.join(", ")}. A failed check also needs proof.`,
    "Do not claim a pass without a capture that proves it. Cite an output or response line, not a request line.",
    "Finish with the message you would send to the person who asked you to run the journey.",
  ].filter((line) => line !== undefined).join("\n");
}

/** @param {ReturnType<typeof recording>} seat @param {string} state */
function importResults(seat, state) {
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

/**
 * Run a command line the way the caller's terminal would, with the caller's
 * environment, so the agent's own login works. Keeps the end of its output.
 * @param {string} command
 * @param {{cwd: string, stdin: string, timeout: number}} options
 * @returns {Promise<{code: number | null, stdout: string, timedOut: boolean}>}
 */
function shellResult(command, { cwd, stdin, timeout }) {
  return new Promise((done) => {
    const child = spawn(command, { cwd, shell: true, detached: true, stdio: ["pipe", "pipe", "inherit"] });
    let stdout = "", timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch {}
    }, timeout);
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-CAPTURE_LIMIT); });
    child.once("error", () => { clearTimeout(timer); done({ code: null, stdout, timedOut }); });
    child.once("close", (code) => { clearTimeout(timer); done({ code, stdout, timedOut }); });
  });
}
