// RunRecorder: builds a v1 run folder, line by line. The Playwright fixture
// uses it, and so can any script or agent that drives the app its own way.
// The runner says who did each line (by); the recorder checks it against the
// journey's users and refuses a step the run file rules would reject.
//
//   const run = RunRecorder.start({ journey: "journeys/share-by-link.journey.yaml", ranBy: { agent: "codex" } });
//   run.user("viewer", "viewer-91fa@example.test");
//   run.step("Turn on link sharing and send the link to the viewer.", { by: "you",
//     screenshots: [{ image: "shots/1.png", url: "https://app.example.test/p/q3-plan" }] });
//   run.check("link-on", { by: "you", verdict: "passed", proof: "Reloaded and read the saved setting.",
//     evidence: [{ source: "api", login: "you", url: "https://app.example.test/api/share", got: { linkSharing: true } }] });
//   run.finish();   // writes journey-runs/<journey name>/<run id>/
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { journeyName, journeyPlan, loadJourney, validateJourney } from "../format/format.js";
import { writeRunFolder } from "../format/run-folder.js";
import { FILE_NAME, LOOKUP, RUN_FORMAT, isCheck, settle, stepProblems } from "../format/runfile.js";
import { makeRedactor } from "./capture.js";
import { maskRun } from "./mask.js";
import { VERSION } from "../shared/version.js";

export { recording } from "./recording.js";

/**
 * @typedef {import("../format/runfile.js").Run} Run
 * @typedef {import("../format/runfile.js").Evidence} Evidence
 * @typedef {Partial<import("../format/runfile.js").ActionStep & import("../format/runfile.js").CheckStep>} StepFields an action or a check, field by field
 * @typedef {import("../format/format.js").PlanLine} PlanLine
 * @typedef {Extract<PlanLine, {kind: "check"}>} CheckLine
 * @typedef {Buffer|string} Image PNG bytes, or a path to a PNG
 * @typedef {Image | {image: Image, url?: string}} Shot an image, or an image and the full address of the page it shows
 * @typedef {{by?: string, at?: number, took?: number, screenshots?: Shot|Shot[], cause?: string, reason?: string}} Timing
 *   by: who did the line, or whose view the check is about: "you" or a name from the journey's users.
 *   Needed on anything done, passed or failed.
 * @typedef {{
 *   journey: string|import("../format/format.js").Journey, file?: string, name?: string, case?: string|null,
 *   ranBy?: {agent?: string, model?: string}, users?: Record<string, string|null>, playedBy?: Record<string, string>, repeat?: {batch: string, n: number, of: number}, tags?: Record<string, unknown>,
 *   repos?: Array<{repo: string, commit?: string, branch?: string}>, outputDir?: string, id?: string, now?: () => number,
 * }} StartOptions
 */

export class RunRecorder {
  /** Each secret `${name}` and its value, in memory only, to keep it out of the run. @type {Map<string, unknown>} */
  #secrets = new Map();
  /** @type {((text: string) => string) | undefined} */
  #redactOutput;

  /** @param {StartOptions} options journey is a path to a journey file, or a parsed journey (then pass file or name) */
  static start(options) {
    return new RunRecorder(options);
  }

  /** @param {StartOptions} options */
  constructor({ journey, file, name, case: caseId = null, ranBy, users = {}, playedBy = {}, repeat, tags = {}, repos, outputDir = "journey-runs", id, now = Date.now }) {
    this.file = typeof journey === "string" ? journey : (file ?? null);
    this.journey = typeof journey === "string" ? loadJourney(journey) : journey;
    const problems = validateJourney(this.journey);
    if (problems.length) throw new Error(`${this.file ?? "The journey"} is not a valid journey:\n- ${problems.join("\n- ")}`);
    // A draft 0 journey carries its own id.
    /** @type {string} */
    this.name = /** @type {string} */ (name ?? (this.file ? journeyName(this.file) : this.journey.id));
    if (!this.name) throw new Error("Say the journey's name: pass the journey's file path, or name.");
    this.plan = journeyPlan(this.journey, caseId);
    this.outputDir = outputDir;
    this.now = now;
    this.startMs = now();
    this.id = id ?? runId(this.startMs);
    this.ranBy = compact({ agent: process.env.JOURNEYSFIRST_AGENT, model: process.env.JOURNEYSFIRST_MODEL, ...ranBy });
    /** @type {Record<string, string|null>} */
    this.users = Object.fromEntries(this.plan.everyone.map((u) => [u, null]));
    for (const [user, account] of Object.entries(users)) this.user(user, account);
    /** @type {Record<string, string>} */
    this.played = {};
    /** One of several runs of this journey, when it is: {batch, n, of}. */
    this.repeat = repeat;
    for (const [user, who] of Object.entries(playedBy)) this.playedBy(user, who);
    /** @type {Record<string, unknown>} */
    this.tags = compact({ environment: process.env.JOURNEYSFIRST_ENV, ...tags });
    this.repos = repos ?? currentRepos();
    /** @type {NonNullable<Run["values"]>} */
    this.values = {};
    /** @type {import("../shared/display.js").MediaItem[]} */
    this.media = [];
    /** @type {Map<number, StepFields>} line number to its recorded step */
    this.recorded = new Map();
    /** @type {Map<string, Buffer>} */
    this.files = new Map();
  }

  /** Seconds since the run started. */
  elapsed() {
    return round((this.now() - this.startMs) / 1000);
  }

  /**
   * The account a user used in this run.
   * @param {string} name
   * @param {string|null} [account]
   */
  user(name, account) {
    this.knows(name);
    this.users[name] = account ?? null;
  }

  /**
   * Who played a user in this run, as launched: "a script", or the agent, its version and model, like "Claude Code 2.4.1, opus".
   * @param {string} name
   * @param {string} who
   */
  playedBy(name, who) {
    this.knows(name);
    if (typeof who !== "string" || !who.trim()) throw new Error(`Say who played ${name}, like "a script" or "Claude Code 2.4.1, opus".`);
    this.played[name] = who;
  }


  /**
   * Throws unless name is "you" or a user in this journey.
   * @param {string} [name]
   */
  knows(name) {
    const users = Object.keys(this.users).join(", ");
    if (name === undefined) throw new Error(`Say who did this line, with by: one of ${users}.`);
    if (!(name in this.users)) throw new Error(`"${name}" is not a user in this journey. Users: ${users}.`);
  }

  /**
   * The value a `${name}` had in this run. A secret's value is never written:
   * the run says only that it was secret, and the run is refused if the value
   * shows up anywhere else in it.
   * @param {string} name
   * @param {unknown} value
   * @param {{secret?: boolean}} [options]
   */
  value(name, value, { secret } = {}) {
    if (secret) this.#secrets.set(name, value);
    else this.#secrets.delete(name);
    if (secret) this.values[name] = { secret: true };
    else this.values[name] = secret === undefined ? { value } : { value, secret };
  }

  /**
   * Secret values still in memory, longest first. For a screenshot and a
   * trace. Nothing here is written into the run file.
   * @returns {string[]}
   */
  secretValues() {
    const values = [];
    for (const value of this.#secrets.values()) {
      const text = typeof value === "string" || typeof value === "number" || typeof value === "bigint" ? String(value) : "";
      if (text.length >= 4) values.push(text);
    }
    return values.sort((a, b) => b.length - a.length);
  }

  /**
   * A fact about this run to filter on, like environment or device.
   * @param {string} key
   * @param {unknown} value
   */
  tag(key, value) {
    this.tags[key] = value;
  }

  /**
   * Add a video, recording or other file to the run's media.
   * @param {{name: string, body?: Buffer|string, path?: string, kind: string, starts_at?: number, tags?: Record<string, unknown>}} item
   */
  attach({ name, body, path, kind, starts_at, tags }) {
    const file = this.#addFile(name, body !== undefined ? Buffer.from(body) : readFileSync(/** @type {string} */ (path)));
    this.media.push(compact({ file, kind, starts_at, tags }));
    return file;
  }

  /**
   * Text with each secret's value replaced by its `${name}`, for a file the
   * run attaches. result() checks run.json and attached transcripts for secrets.
   * @param {string} text
   */
  redact(text) {
    if (this.#redactOutput) text = this.#redactOutput(text);
    for (const [name, value] of this.#secrets) {
      const secret = String(value ?? "");
      if (secret) text = text.replaceAll(secret, `\${${name}}`).replaceAll(JSON.stringify(secret).slice(1, -1), `\${${name}}`);
    }
    return text;
  }

  /** @param {string[]} values exact host values to mask in recorded text, not in the run's structural fields */
  redactOutputValues(values) {
    this.#redactOutput = values.some(Boolean) ? makeRedactor(values) : undefined;
  }

  /**
   * Record an action line.
   * @param {number|string} line the line number (from 1) or the action's sentence
   * @param {Timing & {status?: "done"|"failed"|"blocked"|"not_run"}} result
   */
  step(line, { by, status = "done", ...rest } = {}) {
    const plan = this.actionLine(line);
    this.#record(plan, { says: plan.says, by, status }, rest);
  }

  /**
   * Record a check. A claimed pass stands only with evidence from the login of
   * the user in by; otherwise it becomes not_checked. A failed check means
   * the product did the wrong thing, so its cause is product unless you say.
   * @param {string} id the check's id from the journey
   * @param {Timing & {verdict?: "passed"|"failed"|"blocked"|"not_checked", proof?: string, evidence?: Evidence[]}} result
   */
  check(id, { by, verdict = "not_checked", proof, evidence = [], cause, ...rest } = {}) {
    const plan = this.checkLine(id);
    if (verdict === "failed") cause ??= "product";
    this.#record(plan, compact({ check: plan.check, id, by, verdict, proof, evidence, launcher_probe: plan.launcher_probe }), { cause, ...rest });
  }

  /**
   * Mark a line blocked: setup or the environment broke, so it couldn't be done.
   * Checks after it that have no verdict of their own are blocked too.
   * @param {number|string} line a line number, an action's sentence, or a check id
   * @param {{reason: string, cause?: "environment"|"test"|"product", by?: string}} why
   */
  blocked(line, { reason, cause = "environment", by }) {
    const check = typeof line === "string" ? this.plan.lines.find((l) => l.kind === "check" && l.id === line) : null;
    if (check) this.check(/** @type {string} */ (line), { by, verdict: "blocked", cause, reason });
    else this.step(line, { by, status: "blocked", cause, reason });
  }

  /**
   * The run file and its files, without writing anything. Throws when a
   * secret value appears in the run metadata or an attached transcript.
   * @param {{summary?: string, attempt?: Run["attempt"]}} [options]
   * @returns {{run: Run, files: Map<string, Buffer>}}
   */
  result({ summary, attempt } = {}) {
    /** @type {(StepFields & {n: number}) | null} */
    let blockedBy = null;
    // Each recorded step passed stepProblems, so the list is a run's steps.
    const steps = /** @type {Run["steps"]} */ (
      this.plan.lines.map((line) => {
        const step = this.recorded.get(line.n) ?? unrecorded(line, blockedBy);
        if (!blockedBy && (step.status === "blocked" || step.verdict === "blocked")) blockedBy = { n: line.n, ...step };
        return /** @type {{added?: boolean}} */ (line).added ? { ...step, added: true } : step;
      })
    );
    // settle works out result, verified and not_verified; the undefined keys only fix their order.
    // result is undefined until then, so this is not a Run yet.
    const { run } = settle(/** @type {Run} */ (/** @type {unknown} */ ({
      format: RUN_FORMAT,
      id: this.id,
      journey: { name: this.name, version: this.plan.version, case: this.plan.case },
      result: undefined,
      summary,
      attempt: attempt && { ...attempt },
      started_at: new Date(this.startMs).toISOString(),
      finished_at: new Date(this.now()).toISOString(),
      ran_by: Object.keys(this.ranBy).length ? this.ranBy : undefined,
      journeysfirst: VERSION,
      tags: Object.keys(this.tags).length ? this.tags : undefined,
      repos: this.repos.length ? this.repos : undefined,
      users: this.users,
      played_by: Object.keys(this.played).length ? this.played : undefined,
      repeat: this.repeat,
      values: Object.keys(this.values).length ? this.values : undefined,
      media: this.media.length ? this.media : undefined,
      verified: undefined,
      not_verified: undefined,
      steps,
    })));
    run.summary ??= run.attempt?.status === "aborted" ? run.attempt.reason : defaultSummary(run.result, run.steps);
    if (this.#secrets.size && (run.media ?? []).some(({ file, kind }) =>
      kind === "transcript" && transcriptHasSecret(this.files.get(file), this.#secrets))) {
      throw new Error("A declared secret is in an attached transcript. Remove it from the transcript before writing the run.");
    }
    const leaks = secretLeaks(run, this.#secrets);
    if (leaks.length) throw new Error(`${leaks.join("\n")}\nA secret's value must never be written to the run. Take it out of those fields, or don't mark the value secret.`);
    // After the check, so a declared secret still refuses the run. Patterns
    // that were never marked secret are covered instead of kept.
    maskRun(run);
    return { run: compact(run), files: new Map(this.files) };
  }

  /**
   * Finish and write the run folder: <outputDir>/<journey name>/<run id>/.
   * @param {{summary?: string, attempt?: Run["attempt"]}} [options]
   * @returns {{folder: string, run: Run}}
   */
  finish(options) {
    const { run, files } = this.result(options);
    return writeRunFolder(this.outputDir, run, files, this.journey);
  }

  /**
   * @param {PlanLine} plan
   * @param {StepFields} step
   * @param {Timing} timing
   */
  #record(plan, step, { at, took, screenshots, cause, reason }) {
    const previous = this.recorded.get(plan.n);
    /** @type {import("../format/runfile.js").Screenshot[]} */
    const names = [...(previous?.screenshots ?? [])];
    for (const shot of [screenshots ?? []].flat()) {
      const { image, url } = isMapShot(shot) ? shot : { image: shot, url: undefined };
      if (!image) continue;
      const name = names.length === 0 ? `step-${plan.n}.png` : `step-${plan.n}-${names.length + 1}.png`;
      this.#addFile(name, typeof image === "string" ? readFileSync(image) : Buffer.from(image));
      names.push(url ? { file: name, url } : name);
    }
    const recorded = compact({ ...step, at: at ?? previous?.at ?? this.elapsed(), took, screenshots: names.length ? names : undefined, cause, reason });
    // The rules every reader applies to the file, checked now so the error points at this call.
    const problems = stepProblems(recorded, plan.n, Object.keys(this.users));
    if (problems.length) throw new Error(problems.join("\n"));
    this.recorded.set(plan.n, recorded);
  }

  /**
   * The journey line for an action: its line number (from 1) or its sentence.
   * @param {number|string} line
   */
  actionLine(line) {
    const actions = this.plan.lines.filter((l) => l.kind === "action");
    const found = typeof line === "number"
      ? this.plan.lines[line - 1]
      : (actions.find((l) => l.says === line && !this.recorded.has(l.n)) ?? actions.find((l) => l.says === line));
    if (found?.kind === "check") throw new Error(`Line ${line} is a check. Record it with check("${found.id}").`);
    if (!found) throw new Error(`"${line}" is not an action in ${this.name}. Its actions are:\n${actions.map((l) => `  ${l.n}. ${l.says}`).join("\n")}`);
    return found;
  }

  /**
   * The journey line for a check id.
   * @param {string} id
   */
  checkLine(id) {
    const found = /** @type {CheckLine | undefined} */ (this.plan.lines.find((l) => l.kind === "check" && l.id === id));
    if (!found) throw new Error(`"${id}" is not a check id in ${this.name}. Its checks are: ${this.plan.lines.filter((l) => l.kind === "check").map((l) => l.id).join(", ")}.`);
    return found;
  }

  /**
   * @param {string} name
   * @param {Buffer} bytes
   */
  #addFile(name, bytes) {
    if (!FILE_NAME.test(name ?? "")) throw new Error(`"${name}" must be a plain file name.`);
    this.files.set(name, bytes);
    return name;
  }
}

/** The repo in the current folder, as run results `repos`. Empty outside git. */
export function currentRepos() {
  try {
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const top = git("rev-parse", "--show-toplevel");
    let repo = basename(top);
    try {
      repo = git("remote", "get-url", "origin").match(/[:/]([^/:]+\/[^/]+?)(\.git)?$/)?.[1] ?? repo;
    } catch {
      // No remote: the folder name will do.
    }
    return [{ repo, commit: git("rev-parse", "HEAD"), branch: git("rev-parse", "--abbrev-ref", "HEAD") }];
  } catch {
    return [];
  }
}

/** A run id like 2026-11-08-1802-7d2e91fa: the start time in UTC, then 8 random hex. */
/** @param {number} ms */
export function runId(ms) {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}-${randomBytes(4).toString("hex")}`;
}

/**
 * @param {PlanLine} line
 * @param {(StepFields & {n: number}) | null} blockedBy
 * @returns {StepFields}
 */
function unrecorded(line, blockedBy) {
  if (line.kind === "action") return { says: line.says, status: "not_run" };
  const check = { check: line.check, id: line.id, ...(line.launcher_probe ? { launcher_probe: line.launcher_probe } : {}) };
  if (blockedBy) return { ...check, verdict: "blocked", cause: blockedBy.cause, reason: `Step ${blockedBy.n} was blocked: ${blockedBy.reason}` };
  return { ...check, verdict: "not_checked", reason: "No check ran." };
}

/**
 * @param {string} result
 * @param {Run["steps"]} steps
 */
function defaultSummary(result, steps) {
  const checks = steps.filter(isCheck);
  if (result === "passed") return `All ${checks.length} checks passed.`;
  const failed = checks.filter((s) => s.verdict === "failed");
  if (result === "failed") return failed.length === 1 && failed[0].reason ? failed[0].reason : `${failed.length} of ${checks.length} checks failed.`;
  return `Nothing failed, but ${checks.filter((s) => s.verdict !== "passed").length} of ${checks.length} checks were not fully checked.`;
}

/**
 * One line for each secret whose value appears in the run, naming each field
 * it is in by its path, like steps[1].evidence[0].got. Never the value.
 * @param {unknown} run
 * @param {Map<string, unknown>} secrets
 * @returns {string[]}
 */
function secretLeaks(run, secrets) {
  const values = [...secrets].flatMap(([name, value]) =>
    (typeof value === "string" || typeof value === "number" || typeof value === "bigint") && String(value)
      ? [{ name, text: String(value) }] : []);
  if (!values.length) return [];
  const lines = [];
  const matches = [...new Set(values.map(({ text }) => text))].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(matches.map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const fields = [...stringFields(run, "")];
  for (const { name, text } of values) {
    const paths = new Set(fields.filter(([, s]) => s.includes(text)).map(([path]) => path.replace(pattern, "[redacted]")));
    if (paths.size) lines.push(`The secret \${${name.replace(pattern, "[redacted]")}} is in the run at ${[...paths].join(", ")}.`);
  }
  return lines;
}

/** @param {Buffer | undefined} body @param {Map<string, unknown>} secrets */
function transcriptHasSecret(body, secrets) {
  if (!body) return false;
  const text = body.toString("utf8");
  for (const value of secrets.values()) {
    const secret = String(value ?? "");
    if (secret && (text.includes(secret) || text.includes(JSON.stringify(secret).slice(1, -1)))) return true;
  }
  return false;
}

/**
 * Every text value and every data key, with its path.
 * @param {unknown} value
 * @param {string} path
 * @param {string} [shape] the format path, stopped when entering free-form data
 * @returns {Generator<[string, string]>}
 */
function* stringFields(value, path, shape = "") {
  if (typeof value === "string" || typeof value === "number") yield [path, String(value)];
  else if (Array.isArray(value)) for (const [i, item] of value.entries()) yield* stringFields(item, `${path}[${i}]`, `${shape}[]`);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const field = path ? `${path}.${key}` : key;
      const defined = FORMAT_KEYS.get(shape)?.has(key);
      if (!defined) yield [field, key];
      const child = shape === "values" ? "values.*" : defined ? (shape ? `${shape}.${key}` : key) : "*";
      yield* stringFields(item, field, child);
    }
  }
}

const evidenceKeys = new Set(["source", "login", "key", ...Object.values(LOOKUP)]);
const FORMAT_KEYS = new Map([
  ["", new Set("format id journey result summary attempt started_at finished_at ran_by journeysfirst tags repos users played_by repeat values media verified not_verified steps findings reviews".split(" "))],
  ["attempt", new Set(["status", "reason"])],
  ["journey", new Set(["name", "version", "case"])],
  ["ran_by", new Set(["agent", "model"])],
  ["repos[]", new Set(["repo", "branch", "commit"])],
  ["repeat", new Set(["batch", "n", "of"])],
  ["values.*", new Set(["value", "secret"])],
  ["media[]", new Set(["file", "kind", "starts_at", "tags"])],
  ["steps[]", new Set("says status check id by verdict claimed proof evidence at took screenshots cause reason added".split(" "))],
  ["steps[].screenshots[]", new Set(["file", "url"])],
  ["steps[].evidence[]", evidenceKeys],
  ["findings[]", new Set(["id", "criterion", "says", "evidence", "step", "ask"])],
  ["findings[].evidence[]", evidenceKeys],
  ["reviews[]", new Set(["by", "at", "on", "says"])],
]);

/** A screenshot given as {image, url}, not bare bytes or a path. */
/** @param {Shot} shot @returns {shot is {image: Image, url?: string}} */
const isMapShot = (shot) => Boolean(shot) && typeof shot === "object" && !Buffer.isBuffer(shot) && !(shot instanceof Uint8Array);

/**
 * The object without its undefined and null fields.
 * @template {object} T
 * @param {T} object
 * @returns {T}
 */
function compact(object) {
  return /** @type {T} */ (Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null)));
}

/** @param {number} seconds */
const round = (seconds) => Math.round(seconds * 10) / 10;
