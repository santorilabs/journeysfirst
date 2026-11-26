// Journey files. `journeysfirst/v1` is the format (spec/journey-format-v1.md).
// Draft 0 (`journeysfirst/v0`) is still read, so old files keep working.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { LineCounter, parseDocument } from "yaml";
import * as v0 from "./draft0/format-v0.js";
import { stableJson } from "./stable-json.js";
import { validateV1, warnV1 } from "./validate-journey.js";

export const FORMAT = "journeysfirst/v1";
export const FORMAT_V0 = v0.FORMAT;

// A file whose format is FORMAT_V0 is a draft 0 journey, not a v1 one.
/** @typedef {import("./draft0/format-v0.js").V0Journey} V0Journey */

/**
 * @typedef {string | {check: string, id: string, added?: boolean, launcher?: string, [field: string]: unknown}} Line
 * @typedef {{name: string, id: string, start: string, steps: Line[], users?: string[], setup?: string, added?: boolean}} Case
 * @typedef {{format: string, title: string, promise: string, users?: string[], start?: string, setup?: string, steps?: Line[], cases?: Case[], notes?: string, [field: string]: unknown}} Journey
 * @typedef {{kind: "action", n: number, says: string} | {kind: "check", n: number, check: string, id: string, added?: boolean, launcher?: string}} PlanLine
 * @typedef {{version: string, case: string|null, everyone: string[], lines: PlanLine[]}} Plan
 */

// The YAML source of each parsed journey, so problems can name their line.
/** @type {WeakMap<object, {doc: import("yaml").Document, lineCounter: LineCounter}>} */
const sources = new WeakMap();

/**
 * @param {string} text
 * @returns {Journey}
 */
export function parseJourney(text) {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  if (doc.errors.length) {
    const error = doc.errors[0];
    const line = error.linePos?.[0]?.line;
    throw new Error(`${line ? `line ${line}: ` : ""}this is not valid YAML. ${error.message.split("\n")[0]}`);
  }
  const journey = doc.toJS();
  if (journey && typeof journey === "object") sources.set(journey, { doc, lineCounter });
  return journey;
}

/**
 * @param {string} path
 * @returns {Journey}
 */
export function loadJourney(path) {
  try {
    return parseJourney(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: ${/** @type {Error} */ (error).message}`);
  }
}

/**
 * The journey's name: its file name without `.journey.yaml`.
 * @param {string} path
 */
export function journeyName(path) {
  return basename(path).replace(/\.journey\.ya?ml$/, "").replace(/\.ya?ml$/, "");
}

/**
 * Problems that make a journey unusable. An empty list means it is valid.
 * Each problem names the line and step it points at, when the journey was parsed from text.
 * @param {Journey} journey
 * @returns {string[]}
 */
export function validateJourney(journey) {
  if (!journey || typeof journey !== "object" || Array.isArray(journey)) {
    return ["The file is not a journey. It should have format, title, promise, start and steps."];
  }
  if (journey.format === FORMAT_V0) return v0.validateJourney(/** @type {V0Journey} */ (/** @type {unknown} */ (journey)));
  if (journey.format !== FORMAT) return [`format must be "${FORMAT}".`];
  return validateV1(journey, (path) => where(journey, path));
}

/**
 * Things that are allowed but probably wrong, such as a line that starts with
 * "The admin" when admin is not in users. They never make a journey invalid.
 * @param {Journey} journey
 * @returns {string[]}
 */
export function journeyWarnings(journey) {
  if (!journey || journey.format !== FORMAT) return [];
  return warnV1(journey, (path) => where(journey, path));
}

/**
 * The journey's version: a hash of what the journey promises. notes (hints for
 * runners) and fields a tool or team added (tags, anything unknown) never
 * change it.
 * @param {Journey} journey
 */
export function journeyVersion(journey) {
  if (journey.format === FORMAT_V0) return v0.journeyVersion(/** @type {V0Journey} */ (/** @type {unknown} */ (journey)));
  const line = (/** @type {Line} */ step) => (typeof step === "string" ? step : { check: step.check, id: step.id, added: step.added, launcher: step.launcher });
  const intent = {
    title: journey.title,
    promise: journey.promise,
    users: journey.users,
    start: journey.start,
    setup: journey.setup,
    steps: journey.steps?.map(line),
    cases: journey.cases?.map((c) => ({ name: c.name, id: c.id, start: c.start, setup: c.setup, users: c.users, added: c.added, steps: c.steps?.map(line) })),
  };
  return createHash("sha256").update(stableJson(intent)).digest("hex").slice(0, 8);
}

/**
 * The case ids of a journey, or [] when it has none.
 * @param {Journey} journey
 * @returns {string[]}
 */
export function caseIds(journey) {
  return (journey.cases ?? []).map((c) => c.id);
}

/**
 * The lines of one run of a journey, in order, numbered from 1, and everyone in it.
 * A journey with cases needs the case id; one without takes null.
 * @param {Journey} journey
 * @param {string|null} [caseId]
 * @returns {Plan}
 */
export function journeyPlan(journey, caseId = null) {
  if (journey.format === FORMAT_V0) {
    const { people: users, lines } = v0.toLines(/** @type {V0Journey} */ (/** @type {unknown} */ (journey)));
    return { version: journeyVersion(journey), case: null, everyone: users, lines: number(lines) };
  }
  /** @type {Journey | Case | undefined} */
  let source = journey;
  if (journey.cases) {
    source = journey.cases.find((c) => c.id === caseId);
    if (!source) throw new Error(`This journey has cases. Say which one runs: ${caseIds(journey).join(", ")}.`);
  } else if (caseId) {
    throw new Error(`This journey has no cases, so there is no case "${caseId}".`);
  }
  const users = [...new Set([...(journey.users ?? []), ...(source.users ?? [])])];
  /** @type {Array<Omit<Extract<PlanLine, {kind: "action"}>, "n"> | Omit<Extract<PlanLine, {kind: "check"}>, "n">>} */
  const lines = (source.steps ?? []).map((step) =>
    typeof step === "string"
      ? { kind: "action", says: step }
      : { kind: "check", check: step.check, id: step.id, ...(step.added ? { added: true } : {}), ...(step.launcher ? { launcher: step.launcher } : {}) },
  );
  return { version: journeyVersion(journey), case: caseId, everyone: ["you", ...users], lines: number(lines) };
}

/**
 * @template {object} T
 * @param {T[]} lines
 * @returns {Array<T & {n: number}>}
 */
function number(lines) {
  return lines.map((line, i) => ({ ...line, n: i + 1 }));
}

/**
 * "line 9, step 3: " for a path like ["steps", 2].
 * @param {Journey} journey
 * @param {Array<string|number>} path
 */
function where(journey, path) {
  /** @type {string[]} */
  const parts = [];
  const line = lineOf(journey, path);
  if (line) parts.push(`line ${line}`);
  for (let i = 0; i < path.length; i++) {
    const next = path[i + 1];
    if (path[i] === "steps" && typeof next === "number") parts.push(`step ${next + 1}`);
    if (path[i] === "cases" && typeof next === "number") {
      const c = journey.cases?.[next];
      parts.push(`case ${typeof c?.id === "string" ? `"${c.id}"` : next + 1}`);
    }
  }
  return parts.length ? `${parts.join(", ")}: ` : "";
}

/**
 * @param {Journey} journey
 * @param {Array<string|number>} path
 * @returns {number|null}
 */
function lineOf(journey, path) {
  const source = sources.get(journey);
  if (!source) return null;
  for (let n = path.length; n > 0; n--) {
    const node = /** @type {import("yaml").Node | undefined} */ (source.doc.getIn(path.slice(0, n), true));
    if (node?.range) return source.lineCounter.linePos(node.range[0]).line;
  }
  return null;
}
