// Run results v1 (spec/run-results-v1.schema.json): what one run of a journey did and
// proved. Any tool can write it; the review UI, publish and a service read it.
import { createHash } from "node:crypto";
import { isCheck, screenshotFile } from "../shared/display.js";
import { stableJson } from "./stable-json.js";
import { LAUNCHER_CHECKS } from "./validate-journey.js";

export const RUN_FORMAT = "journeysfirst-run/v1";
export const VERDICTS = ["passed", "failed", "blocked", "not_checked"];
export const STEP_STATUSES = ["done", "failed", "blocked", "not_run"];
export const RESULTS = ["passed", "failed", "not_fully_checked"];
export const CAUSES = ["product", "test", "environment"];
// Where evidence came from, and the field that lets someone look it up again.
export const LOOKUP = { page: "url", api: "url", database: "query", log: "query", message: "message_id", launcher: "query" };
export const SOURCES = Object.keys(LOOKUP);
export const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// A full page address, like https://app.example.test/p/q3-plan.
export const FULL_URL = /^https?:\/\/[^/?#\s]+/;

/**
 * @typedef {{source: string, login?: string, key?: string, [field: string]: unknown}} Evidence a user's own login, or the name of the admin or service key used
 * @typedef {string | {file: string, url?: string}} Screenshot a file name in the run folder, or the file and the full address of the page it shows
 * @typedef {{says: string, by: string, status: string, at?: number, took?: number, screenshots?: Screenshot[], cause?: string, reason?: string}} ActionStep
 * @typedef {{check: string, id: string, by: string, verdict: string, claimed?: string, proof?: string, evidence?: Evidence[], at?: number, took?: number, screenshots?: Screenshot[], cause?: string, reason?: string, added?: boolean, launcher_probe?: string}} CheckStep
 * @typedef {{id: string, criterion: string, says: string, evidence: Evidence[], step?: number, ask?: string}} Finding what a review against fixed criteria found. With ask, it is a question for a person.
 * @typedef {{status: "complete", reason?: string} | {status: "aborted", reason: string}} Attempt
 * @typedef {{
 *   format: string, id: string, journey: {name: string, version: string, case: string|null}, result: string,
 *   summary?: string, attempt?: Attempt, started_at: string, finished_at?: string, ran_by?: {agent?: string, model?: string}, journeysfirst?: string,
 *   tags?: Record<string, unknown>, users?: Record<string, string|null>, played_by?: Record<string, string>, repeat?: {batch: string, n: number, of: number}, values?: Record<string, {value?: unknown, secret?: boolean}>,
 *   repos?: Array<{repo: string, commit?: string, branch?: string}>, media?: import("../shared/display.js").MediaItem[],
 *   verified?: string[], not_verified?: string[], findings?: Finding[], reviews?: Array<{by: string, at: string, on: string, says: string}>,
 *   steps: Array<ActionStep|CheckStep>, [field: string]: unknown,
 * }} Run
 */

// isCheck and screenshotFile live in display.js, which a browser can load.
export { isCheck, screenshotFile };

/**
 * Why a check that claims `passed` can't count, or null when it can. A pass
 * needs evidence, and some of it from the login of the user the check is about.
 * @param {CheckStep} step
 */
function missingProof(step) {
  const evidence = Array.isArray(step.evidence) ? step.evidence : [];
  if (evidence.length === 0) return "No evidence was attached.";
  if (step.launcher_probe !== undefined) {
    return evidence.some((e) => e?.source === "launcher" && e.probe === step.launcher_probe && e.login === undefined && e.key === undefined)
      ? null : "No evidence came from the matching launcher probe.";
  }
  if (step.by && !evidence.some((e) => e?.source !== "launcher" && e?.login === step.by)) return `No evidence came from ${step.by === "you" ? "your" : `the ${step.by}'s`} own login.`;
  return null;
}

/**
 * The verdict that stands: a claimed pass without its proof becomes
 * not_checked, and the claim is kept as `claimed: "passed"`.
 * @param {CheckStep} step
 * @returns {CheckStep}
 */
export function settleCheck(step) {
  if (step.verdict !== "passed") return step;
  const reason = missingProof(step);
  return reason ? { ...step, verdict: "not_checked", claimed: "passed", reason } : step;
}

/**
 * The whole run's result. failed: any check failed, or an action failed
 * because of the product. passed: every check passed, every action is
 * done, and the attempt did not abort. Otherwise not_fully_checked.
 * @param {Array<ActionStep|CheckStep>} steps
 * @param {Attempt} [attempt]
 */
export function runResult(steps, attempt) {
  const checks = steps.filter(isCheck);
  const actions = /** @type {ActionStep[]} */ (steps.filter((s) => isMap(s) && !isCheck(s)));
  if (checks.some((s) => s.verdict === "failed") || actions.some((s) => s.status === "failed" && s.cause === "product")) return "failed";
  if (attempt?.status === "aborted") return "not_fully_checked";
  if (checks.length > 0 && checks.every((s) => s.verdict === "passed") && actions.every((s) => s.status === "done")) return "passed";
  return "not_fully_checked";
}

/**
 * The run as the rules say it stands: every claimed pass without its proof is
 * settled to not_checked, and result, verified and not_verified are worked out
 * from the steps. Also returns the ids it settled.
 * @param {Run} run
 * @returns {{run: Run, settled: string[]}}
 */
export function settle(run) {
  /** @type {string[]} */
  const settled = [];
  const steps = run.steps.map((step) => {
    if (!isCheck(step)) return step;
    const after = settleCheck(step);
    if (after !== step) settled.push(step.id);
    return after;
  });
  return { run: { ...run, result: runResult(steps, run.attempt), ...verifiedLists(steps), steps }, settled };
}

/**
 * Plain sentences for what was verified and what wasn't.
 * @param {Array<ActionStep|CheckStep>} steps
 * @returns {{verified: string[], not_verified: string[]}}
 */
export function verifiedLists(steps) {
  const checks = steps.filter(isCheck);
  return {
    verified: checks.filter((s) => s.verdict === "passed").map((s) => s.check),
    not_verified: checks.filter((s) => s.verdict !== "passed").map((s) => `${String(s.check).replace(/\.$/, "")}: ${lowerFirst(s.reason ?? notCheckedReason(s))}`),
  };
}

/**
 * Problems with one evidence item.
 * @param {unknown} item
 * @param {string[]|null} [users]
 */
function evidenceProblems(item, users) {
  if (!isMap(item)) return ["evidence must be an object with source and login."];
  /** @type {string[]} */
  const problems = [];
  if (!SOURCES.includes(item.source)) problems.push(`evidence source must be one of: ${SOURCES.join(", ")}.`);
  // A read with an admin or service key names the key instead of a login. It
  // is no user's view, so it never counts as evidence for `by`.
  if (item.source === "launcher") {
    if (item.key !== undefined || item.login !== undefined) problems.push("launcher evidence does not name a login or key.");
    if (!LAUNCHER_CHECKS.includes(item.probe)) problems.push("launcher evidence needs a login-reuse or protected-files probe.");
  } else if (item.key !== undefined && item.login !== undefined) problems.push("evidence has both login and key. Use login for a user's own session, key for an admin or service key.");
  else if (item.key !== undefined && !isText(item.key)) problems.push("evidence key must name the key, like SERVICE_ROLE_KEY. Never its value.");
  else if (item.key === undefined && !isText(item.login)) problems.push(`evidence needs login: whose login it came from, you or a name from users. A read with an admin or service key names it in key instead.`);
  else if (item.key === undefined && users && !users.includes(item.login)) problems.push(`evidence login "${item.login}" is not in users (${users.join(", ")}).`);
  const lookup = /** @type {Record<string, string>} */ (LOOKUP)[item.source];
  if (lookup && !isText(item[lookup])) problems.push(`${item.source} evidence needs ${lookup}, so someone can look it up again.`);
  return problems;
}

/**
 * Problems that make a run file unusable. An empty list means it is valid.
 * A claimed pass without its proof is not a problem here: readers settle it
 * (see settle). Pass the journey's plan (journeyPlan) to also check that the
 * steps match the journey's lines, in order.
 * @param {Run} run
 * @param {import("./format.js").Plan} [plan]
 * @returns {string[]}
 */
export function validateRun(run, plan) {
  if (!run || typeof run !== "object" || Array.isArray(run)) return ["The file is not a run."];
  if (Array.isArray(run.outcomes)) return ["This is a draft 0 run file: it has outcomes, not checks in steps. Run the journey again to write a v1 run."];
  /** @type {string[]} */
  const problems = [];
  /** @param {boolean} ok @param {string} message */
  const need = (ok, message) => ok || problems.push(message);

  need(run.format === RUN_FORMAT, `format must be "${RUN_FORMAT}".`);
  if (!isText(run.id)) problems.push("id is missing: give the run an id that never changes, like 2026-11-08-1802-7d2e.");
  else need(FILE_NAME.test(run.id), `id "${run.id}" must be a plain folder name: letters, digits, dots, dashes and underscores.`);
  const journey = run.journey;
  if (!journey || typeof journey !== "object") problems.push("journey is missing: say which journey ran, as {name, version, case}.");
  else {
    need(isText(journey.name) && FILE_NAME.test(journey.name), "journey.name must be the journey's file name, without .journey.yaml.");
    need(isText(journey.version), "journey.version is missing: the version of the journey that ran.");
    need(journey.case === null || isText(journey.case), "journey.case must be the id of the case that ran, or null when the journey has no cases.");
  }
  need(isTime(run.started_at), "started_at must be an ISO time, like 2026-11-08T18:02:11Z.");
  need(run.finished_at === undefined || isTime(run.finished_at), "finished_at must be an ISO time.");
  need(run.project === undefined, "Remove project. A run belongs to whichever project it is published to.");

  const steps = Array.isArray(run.steps) ? run.steps : [];
  if (!Array.isArray(run.steps) || steps.length === 0) problems.push("steps must list every step of the journey, in order.");
  const users = isMap(run.users) ? Object.keys(run.users) : null;
  const stepCount = problems.length;
  steps.forEach((step, i) => stepProblems(step, i + 1, users).forEach((p) => problems.push(p)));
  const stepsOk = problems.length === stepCount;

  if (!RESULTS.includes(run.result)) problems.push(`result must be one of: ${RESULTS.join(", ")}.`);
  else if (steps.length && stepsOk) {
    const expected = runResult(steps, run.attempt);
    const basis = run.attempt?.status === "aborted" ? "the steps and aborted attempt" : "the steps";
    if (run.result !== expected) problems.push(`result is "${run.result}", but ${basis} give "${expected}".`);
  }
  if (steps.length && stepsOk) listProblems(run, steps).forEach((p) => problems.push(p));

  optionalFields(run, steps).forEach((p) => problems.push(p));
  if (plan) planProblems(run, steps, plan).forEach((p) => problems.push(p));
  return problems;
}

/**
 * Problems with one step, numbered from 1. users is everyone in the run, when known.
 * @param {unknown} step
 * @param {number} n
 * @param {string[]|null} [users]
 * @returns {string[]}
 */
export function stepProblems(step, n, users) {
  if (!isMap(step)) return [`step ${n} must be an object.`];
  /** @type {string[]} */
  const problems = [];
  const label = isCheck(step) ? `step ${n} (check "${step.id}")` : `step ${n}`;
  /** @param {boolean} ok @param {string} message */
  const need = (ok, message) => ok || problems.push(`${label} ${message}`);
  if (step.says === undefined && !isCheck(step)) return [`step ${n} has neither says (an action) nor check (a check).`];
  if (/** @type {Record<string, any>} */ (step).says !== undefined && isCheck(step)) return [`step ${n} has both says and check. An action has says; a check has check and id.`];
  const outcome = isCheck(step) ? step.verdict : step.status;
  // by is what the runner says: who did the line, or whose view the check is about.
  // A line nobody did (not run, not checked, blocked) can leave it out.
  if (step.by !== undefined || ["done", "passed", "failed"].includes(outcome)) {
    if (!isText(step.by)) problems.push(`${label} has no by: say who did it, you or a name from users.`);
    else if (users) need(users.includes(step.by), `has by "${step.by}", which is not in users (${users.join(", ")}).`);
  }

  if (isCheck(step)) {
    need(isText(step.check), "has no sentence in check.");
    need(isText(step.id), "has no id.");
    need(VERDICTS.includes(step.verdict), `verdict must be one of: ${VERDICTS.join(", ")}.`);
    need(step.evidence === undefined || Array.isArray(step.evidence), "evidence must be a list.");
    need(step.launcher_probe === undefined || LAUNCHER_CHECKS.includes(step.launcher_probe), "launcher_probe must be login-reuse or protected-files.");
    for (const item of Array.isArray(step.evidence) ? step.evidence : []) {
      for (const p of evidenceProblems(item, users)) problems.push(`${label}: ${p}`);
      if (item?.source === "launcher") need(item.probe === step.launcher_probe, "can cite launcher evidence only for its declared probe.");
    }
    if (["passed", "failed"].includes(step.verdict)) need(isText(step.proof), "has no proof: say how it was proven, in one plain sentence.");
    need(step.claimed === undefined || (step.claimed === "passed" && step.verdict === "not_checked"), 'claimed can only be "passed", on a not_checked check.');
    need(step.added === undefined || typeof step.added === "boolean", "added must be true or false.");
  } else {
    need(isText(step.says), "has no sentence in says.");
    need(STEP_STATUSES.includes(step.status), `status must be one of: ${STEP_STATUSES.join(", ")}.`);
  }
  if (outcome === "failed" || outcome === "blocked") {
    need(CAUSES.includes(step.cause), `is ${outcome}, so it needs a cause: ${CAUSES.join(", ")}.`);
    need(isText(step.reason), `is ${outcome}, so it needs a reason: what went wrong, in one plain sentence.`);
  } else if (step.cause !== undefined) {
    need(CAUSES.includes(step.cause), `cause must be one of: ${CAUSES.join(", ")}.`);
  }
  need(step.at === undefined || isSeconds(step.at), "at must be seconds from the start of the run.");
  need(step.took === undefined || isSeconds(step.took), "took must be a number of seconds.");
  need(step.screenshots === undefined || isScreenshotList(step.screenshots), "screenshots must be a list of file names in the run folder.");
  for (const shot of Array.isArray(step.screenshots) ? step.screenshots : []) {
    if (isMap(shot) && shot.url !== undefined) need(isFullUrl(shot.url), `screenshot ${shot.file} needs url to be the full address of the page, like https://app.example.test/p/q3-plan.`);
  }
  return problems;
}

/**
 * @param {Run} run
 * @param {Array<ActionStep|CheckStep>} steps
 * @returns {string[]}
 */
function optionalFields(run, steps) {
  /** @type {string[]} */
  const problems = [];
  /** @param {boolean} ok @param {string} message */
  const need = (ok, message) => ok || problems.push(message);
  need(run.summary === undefined || isText(run.summary), "summary must be a plain sentence.");
  if (run.attempt !== undefined) {
    const attempt = run.attempt;
    if (!isMap(attempt) || !["complete", "aborted"].includes(attempt.status)) {
      problems.push('attempt must be an object with status "complete" or "aborted".');
    } else if ((attempt.status === "aborted" || attempt.reason !== undefined) && !isText(attempt.reason)) {
      problems.push("attempt.reason must say why in a plain sentence when the attempt is aborted or a reason is given.");
    }
  }
  need(run.ran_by === undefined || isMap(run.ran_by), "ran_by must be an object, like {agent, model}.");
  need(run.journeysfirst === undefined || isText(run.journeysfirst), 'journeysfirst must be the version of Journeys First that wrote the run, like "0.0.3".');
  need(run.tags === undefined || isMap(run.tags), "tags must be an object, like {environment: \"staging\"}.");
  need(run.people === undefined, "people is now called users. Rename it.");
  need(run.users === undefined || (isMap(run.users) && Object.values(run.users).every((a) => a === null || typeof a === "string")), 'users must map each user to the account used, like {you: "owner@example.test"}.');
  if (run.repeat !== undefined) {
    const r = run.repeat;
    need(isMap(r) && isText(r.batch) && Number.isInteger(r.n) && Number.isInteger(r.of) && r.n >= 1 && r.n <= r.of, "repeat must be {batch, n, of}: one of several runs of the same journey, like {batch: \"a1b2c3d4\", n: 2, of: 5}.");
  }
  if (run.played_by !== undefined) {
    if (!isMap(run.played_by) || !Object.values(run.played_by).every(isText)) problems.push('played_by must map a user to who played it, like {agent: "Claude Code 2.4.1, opus"}.');
    else if (isMap(run.users)) for (const u of Object.keys(run.played_by)) need(u in run.users, `played_by names "${u}", which is not in users.`);
  }
  need(run.verified === undefined || isTextList(run.verified), "verified must be a list of plain sentences.");
  need(run.not_verified === undefined || isTextList(run.not_verified), "not_verified must be a list of plain sentences.");
  if (run.values !== undefined) {
    if (!isMap(run.values)) problems.push('values must be an object, like {link: {value: "https://app.example.test/p/q3"}, phone: {secret: true}}.');
    else
      for (const [name, v] of Object.entries(run.values)) {
        if (!isMap(v) || (v.secret !== undefined && typeof v.secret !== "boolean")) problems.push(`values.${name} must be {value}, or {secret: true} for a secret.`);
        // A secret's value is never written, so it can't leak from the run folder, a zip or a service.
        else if (v.secret === true && "value" in v) problems.push(`values.${name} is secret, so it must not carry its value. Write {secret: true}, as the journeysfirst recorder does. A run folder from an older recorder has the value: run the journey again.`);
        else if (v.secret !== true && !("value" in v)) problems.push(`values.${name} needs value, or secret: true for a secret.`);
      }
  }
  if (run.repos !== undefined) {
    if (!Array.isArray(run.repos)) problems.push("repos must be a list of {repo, commit, branch}.");
    else run.repos.forEach((r, i) => need(isMap(r) && isText(r.repo), `repos item ${i + 1} needs repo, like owner/name.`));
  }
  if (run.media !== undefined) {
    if (!Array.isArray(run.media)) problems.push("media must be a list of {file, kind}.");
    else
      run.media.forEach((m, i) => {
        need(isMap(m) && isText(m.file) && FILE_NAME.test(m.file) && isText(m.kind), `media item ${i + 1} needs file (a file name in the run folder) and kind.`);
        need(m?.starts_at === undefined || isSeconds(m.starts_at), `media item ${i + 1}: starts_at must be seconds from the start of the run.`);
        need(m?.tags === undefined || isMap(m.tags), `media item ${i + 1}: tags must be an object.`);
        need(!isMap(m?.tags) || m.tags.person === undefined, `media item ${i + 1}: tags.person is now called user. Rename it.`);
      });
  }
  const checkIds = new Set(steps.filter(isCheck).map((s) => s.id));
  /** @type {Set<unknown>} */
  const findingIds = new Set();
  if (run.findings !== undefined) {
    if (!Array.isArray(run.findings)) problems.push("findings must be a list of {id, criterion, says, evidence}. Write an empty list when the review found nothing.");
    else run.findings.forEach((f, i) => findingProblems(f, i + 1, { users: isMap(run.users) ? Object.keys(run.users) : null, steps: steps.length, checkIds, findingIds }).forEach((p) => problems.push(p)));
  }
  if (run.reviews !== undefined) {
    if (!Array.isArray(run.reviews)) problems.push("reviews must be a list of {by, at, on, says}.");
    else
      run.reviews.forEach((r, i) => {
        if (!isMap(r) || ![r.by, r.at, r.on, r.says].every(isText)) problems.push(`review ${i + 1} needs by, at, on and says.`);
        else need(checkIds.has(r.on) || findingIds.has(r.on), `review ${i + 1} is on "${r.on}", which is not a check id or a finding id in this run.`);
      });
  }
  return problems;
}

/**
 * Problems with one finding, numbered from 1. Adds its id to findingIds. The
 * criteria themselves belong to the journey-review skill: only the shape is
 * checked here.
 * @param {unknown} finding
 * @param {number} n
 * @param {{users: string[]|null, steps: number, checkIds: Set<string>, findingIds: Set<unknown>}} run
 * @returns {string[]}
 */
function findingProblems(finding, n, { users, steps, checkIds, findingIds }) {
  if (!isMap(finding)) return [`finding ${n} must be an object with id, criterion, says and evidence.`];
  /** @type {string[]} */
  const problems = [];
  const label = isText(finding.id) ? `finding ${n} ("${finding.id}")` : `finding ${n}`;
  /** @param {boolean} ok @param {string} message */
  const need = (ok, message) => ok || problems.push(`${label} ${message}`);
  if (!isText(finding.id)) problems.push(`${label} has no id: give it a plain id, like intuitive-feedback-1.`);
  else if (!FILE_NAME.test(finding.id)) problems.push(`${label} needs a plain id: letters, digits, dots, dashes and underscores.`);
  else if (checkIds.has(finding.id)) problems.push(`${label} has the id of a check in this run. Give it its own id, like intuitive-feedback-1.`);
  else if (findingIds.has(finding.id)) problems.push(`${label} has the same id as an earlier finding. Each finding needs its own id.`);
  findingIds.add(finding.id);
  need(isText(finding.criterion), "has no criterion: the id of the criterion it is about, like intuitive-feedback.");
  need(isText(finding.says), "has no says: what was found, in one plain sentence.");
  if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) problems.push(`${label} has no evidence: say what you measured or saw, with its url and login.`);
  else for (const item of finding.evidence) for (const p of evidenceProblems(item, users)) problems.push(`${label}: ${p}`);
  need(finding.step === undefined || (Number.isInteger(finding.step) && finding.step >= 1 && finding.step <= steps), `step must be the number of the step it is about, from 1 to ${steps}. Leave it out when it is about the whole journey.`);
  need(finding.ask === undefined || isText(finding.ask), "ask must be the one question for a person, as a plain sentence.");
  return problems;
}

/**
 * verified must be exactly the passed checks. not_verified has one sentence
 * per other check, in order, each starting with that check's sentence; the
 * rest is the runner's own words.
 * @param {Run} run
 * @param {Array<ActionStep|CheckStep>} steps
 */
function listProblems(run, steps) {
  /** @type {string[]} */
  const problems = [];
  const expected = verifiedLists(steps);
  if (isTextList(run.verified) && stableJson(run.verified) !== stableJson(expected.verified)) {
    problems.push(`verified must list exactly the checks that passed: ${JSON.stringify(expected.verified)}.`);
  }
  if (isTextList(run.not_verified)) {
    const others = /** @type {CheckStep[]} */ (steps.filter((s) => isCheck(s) && s.verdict !== "passed")).map((s) => String(s.check).replace(/\.$/, ""));
    const matches = run.not_verified.length === others.length && others.every((check, i) => /** @type {string[]} */ (run.not_verified)[i].startsWith(check));
    if (!matches) problems.push(`not_verified must have one sentence for each check that did not pass, in order, each starting with the check: ${JSON.stringify(others)}.`);
  }
  return problems;
}

/**
 * Steps must match the journey's lines one to one, in order.
 * @param {Run} run
 * @param {Array<ActionStep|CheckStep>} steps
 * @param {import("./format.js").Plan} plan
 */
function planProblems(run, steps, plan) {
  if (plan.version && run.journey?.version !== plan.version) {
    return [`journey.version is "${run.journey?.version}", but the journey file is "${plan.version}". The journey changed since this run.`];
  }
  if (plan.case !== undefined && (run.journey?.case ?? null) !== plan.case) {
    return [`journey.case is ${JSON.stringify(run.journey?.case ?? null)}, but the journey's lines are for case ${JSON.stringify(plan.case)}.`];
  }
  /** @type {string[]} */
  const problems = [];
  if (steps.length !== plan.lines.length) {
    problems.push(`steps has ${steps.length} items, but the journey has ${plan.lines.length} lines. Every line needs a step, in order.`);
  }
  plan.lines.forEach((line, i) => {
    // The steps may not be valid yet, so read either kind's fields.
    const step = /** @type {Partial<ActionStep & CheckStep> | undefined} */ (steps[i]);
    if (!step) return;
    const n = i + 1;
    if (line.kind === "action") {
      if (step.says !== line.says) problems.push(`step ${n} should be the action "${line.says}".`);
    } else {
      if (step.check !== line.check || step.id !== line.id) problems.push(`step ${n} should be the check "${line.check}" with id "${line.id}".`);
      if (Boolean(step.added) !== Boolean(line.added)) problems.push(`step ${n} (check "${line.id}") must copy added: true from the journey${line.added ? "" : " only when the journey has it"}.`);
      if (step.launcher_probe !== line.launcher_probe) problems.push(`step ${n} (check "${line.id}") must copy launcher_probe from the journey.`);
    }
  });
  return problems;
}

/**
 * Every file a run refers to: step screenshots and media.
 * @param {Run} run
 * @returns {string[]}
 */
export function runFiles(run) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const step of run.steps ?? []) for (const shot of step.screenshots ?? []) names.add(/** @type {string} */ (screenshotFile(shot)));
  for (const item of run.media ?? []) if (item?.file) names.add(item.file);
  return [...names].sort();
}

/** @param {Buffer|string} bytes */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The run's content digest: sha256 over the canonical run.json plus each
 * file's sha256. Formatting and key order never change it.
 * @param {Run} run
 * @param {Record<string, string>} fileDigests file name to sha256
 */
export function runDigest(run, fileDigests) {
  return sha256(stableJson({ run, files: fileDigests }));
}

/** @param {CheckStep} step */
function notCheckedReason(step) {
  if (step.verdict === "not_checked") return "Not checked.";
  return `It was ${step.verdict.replace("_", " ")}.`;
}

/** @param {string} text */
const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);
/** @param {unknown} value @returns {value is string} */
const isText = (value) => typeof value === "string" && value.trim().length > 0;
/** @param {unknown} value @returns {value is string[]} */
const isTextList = (value) => Array.isArray(value) && value.every(isText);
/**
 * An object that is not a list. Its fields are not validated yet, so they are any.
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
const isMap = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
/** @param {unknown} value */
const isTime = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));
/** @param {unknown} value */
const isSeconds = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
/** @param {unknown} value */
const isFileName = (value) => typeof value === "string" && FILE_NAME.test(value);
/** @param {unknown} value */
const isScreenshotList = (value) => Array.isArray(value) && value.every((v) => isFileName(screenshotFile(v)));
/**
 * A full page address, like https://app.example.test/p/q3-plan.
 * @param {unknown} value
 * @returns {value is string}
 */
export const isFullUrl = (value) => typeof value === "string" && FULL_URL.test(value);
