// Journey file format, draft 0 (`journeysfirst/v0`). Legacy: still read so old
// files keep working. New journeys use v1 (see format.js).
import { createHash } from "node:crypto";
import { stableJson } from "../stable-json.js";

export const FORMAT = "journeysfirst/v0";

// What a screenshot alone can't prove, in draft 0.
export const NEEDS = ["second_person", "saved_state", "content_match", "after_reload", "without_reload", "captured_send"];

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * @typedef {{id: string, says: string}} V0Step
 * @typedef {{id: string, after: string, says: string, needs?: string[]}} V0Outcome
 * @typedef {{format: string, id: string, title: string, start: string, people: Record<string, unknown>, steps: V0Step[], outcomes: V0Outcome[]}} V0Journey
 */

/**
 * @param {V0Journey} journey
 * @returns {string[]} problems; empty means valid
 */
export function validateJourney(journey) {
  /** @type {string[]} */
  const problems = [];
  if (!ID.test(journey.id ?? "")) problems.push("id must be lowercase words joined by dashes.");
  if (!isSentence(journey.title)) problems.push("title is missing.");
  if (!isSentence(journey.start)) problems.push("start is missing: say what is true before the first step.");

  const people = Object.keys(journey.people ?? {});
  if (people.length === 0) problems.push("people is missing: name everyone in the journey.");

  const steps = journey.steps ?? [];
  const outcomes = journey.outcomes ?? [];
  if (steps.length === 0) problems.push("steps is missing.");
  if (outcomes.length === 0) problems.push("outcomes is missing: say what should be true after.");

  const seen = new Set();
  for (const item of [...steps, ...outcomes]) {
    if (!ID.test(item.id ?? "")) problems.push(`"${item.id}" is not a valid id.`);
    else if (seen.has(item.id)) problems.push(`"${item.id}" is used twice.`);
    seen.add(item.id);
    if (!isSentence(item.says)) problems.push(`"${item.id}" has no sentence.`);
  }

  const stepIds = new Set(steps.map((step) => step.id));
  for (const step of steps) {
    if (isSentence(step.says) && !people.some((p) => step.says.toLowerCase().includes(p.toLowerCase()))) {
      problems.push(`step "${step.id}" doesn't say who acts. Name one of: ${people.join(", ")}.`);
    }
  }
  for (const outcome of outcomes) {
    if (!stepIds.has(outcome.after)) problems.push(`outcome "${outcome.id}" comes after an unknown step "${outcome.after}".`);
    for (const need of outcome.needs ?? []) {
      if (!NEEDS.includes(need)) problems.push(`outcome "${outcome.id}" needs "${need}", which isn't one of: ${NEEDS.join(", ")}.`);
    }
  }
  return problems;
}

/**
 * A hash of the sentences only, unchanged from draft 0 so old versions still match.
 * @param {V0Journey} journey
 */
export function journeyVersion(journey) {
  const intent = {
    id: journey.id,
    title: journey.title,
    people: journey.people,
    start: journey.start,
    steps: (journey.steps ?? []).map(({ id, says }) => ({ id, says })),
    outcomes: (journey.outcomes ?? []).map(({ id, after, says, needs }) => ({ id, after, says, needs: needs ?? [] })),
  };
  return createHash("sha256").update(stableJson(intent)).digest("hex").slice(0, 16);
}

/**
 * Draft 0 as v1 lines: each step is an action, followed by the outcomes that come after it as checks.
 * @param {V0Journey} journey
 */
export function toLines(journey) {
  const people = Object.keys(journey.people ?? {});
  /** @type {Array<{kind: "action", says: string} | {kind: "check", check: string, id: string}>} */
  const lines = [];
  for (const step of journey.steps ?? []) {
    lines.push({ kind: "action", says: step.says });
    for (const outcome of (journey.outcomes ?? []).filter((o) => o.after === step.id)) {
      lines.push({ kind: "check", check: outcome.says, id: outcome.id });
    }
  }
  return { people, lines };
}

/** @param {unknown} value */
function isSentence(value) {
  return typeof value === "string" && value.trim().length > 0;
}
