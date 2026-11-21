// The rules for a `journeysfirst/v1` journey (spec/journey-format-v1.md).
// Each problem is one plain sentence, prefixed with where it is.

export const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ROLE = /^[a-z][a-z0-9_-]*$/;
const VALUE = /^\$\{[a-z][a-z0-9_]*\}/;

/**
 * Adds a problem at a path.
 * @typedef {(path: Array<string|number>, message: string) => void} Say
 */

/**
 * @param {import("./format.js").Journey} journey
 * @param {(path: Array<string|number>) => string} at "line 9, step 3: " for a path
 * @returns {string[]}
 */
export function validateV1(journey, at) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Say} */
  const say = (path, message) => problems.push(`${at(path)}${message}`);

  if (!isText(journey.title)) say(["title"], 'title is missing: add a one-line name, like "Share a presentation by link".');
  else if (journey.title.trim().includes("\n")) say(["title"], "title must be one line.");
  if (!isText(journey.promise)) say(["promise"], "promise is missing: add what the person asked for, in their own words.");
  if (journey.setup !== undefined && !isText(journey.setup)) say(["setup"], "setup must be the name of the app's setup script.");
  if (journey.notes !== undefined && !isText(journey.notes) && !isTextList(journey.notes)) say(["notes"], "notes must be text.");
  checkUsers(journey, [], say);

  if (journey.cases !== undefined) {
    if (journey.steps !== undefined) say(["steps"], "use steps or cases, not both. With cases, each case has its own start and steps.");
    if (journey.start !== undefined) say(["start"], "start goes inside each case when the journey has cases.");
    checkCases(journey, say);
  } else {
    if (!isText(journey.start)) say(["start"], "start is missing: say what is true before the first step.");
    else checkValues(journey.start, ["start"], say);
    checkSteps(journey.steps, ["steps"], say, new Map());
  }
  return problems;
}

/**
 * @param {import("./format.js").Journey} journey
 * @param {Say} say
 */
function checkCases(journey, say) {
  if (!Array.isArray(journey.cases) || journey.cases.length === 0) {
    say(["cases"], "cases must be a list. Each case has a name, id, start and steps.");
    return;
  }
  /** @type {Map<string, number>} */
  const caseIds = new Map();
  /** @type {Map<string, {sentence: string, case?: string}>} */
  const checks = new Map(); // check id -> {sentence, case}
  journey.cases.forEach((c, i) => {
    const path = ["cases", i];
    if (!c || typeof c !== "object" || Array.isArray(c)) return say(path, "a case must have a name, id, start and steps.");
    if (!isText(c.name)) say(path, "the case has no name. Say in a few words how this case happens.");
    if (c.id === undefined || c.id === null) say(path, "the case has no id. Add one, like id: not-now.");
    else if (typeof c.id !== "string") say([...path, "id"], notText("case id", c.id));
    else if (!ID.test(c.id)) say([...path, "id"], `case id "${c.id}" must be lowercase words joined by dashes, like not-now.`);
    else if (caseIds.has(c.id)) say([...path, "id"], `case id "${c.id}" is already used by case ${/** @type {number} */ (caseIds.get(c.id)) + 1}.`);
    else caseIds.set(c.id, i);
    if (!isText(c.start)) say(path, "the case has no start: say what is true before its first step.");
    else checkValues(c.start, [...path, "start"], say);
    if (c.setup !== undefined && !isText(c.setup)) say([...path, "setup"], "setup must be the name of the app's setup script.");
    if (c.added !== undefined && typeof c.added !== "boolean") say([...path, "added"], "added must be true or false.");
    checkUsers(c, path, say);
    checkSteps(c.steps, [...path, "steps"], say, checks, c.id);
  });
}

/**
 * @param {Record<string, any>} holder the journey or a case
 * @param {Array<string|number>} path where the holder is
 * @param {Say} say
 */
function checkUsers(holder, path, say) {
  if (holder.people !== undefined) say([...path, "people"], "people is now called users. Rename it.");
  const users = holder.users;
  const at = [...path, "users"];
  if (users === undefined) return;
  if (!Array.isArray(users)) return say(at, "users must be a list of role words, like [viewer].");
  if (users.length === 0) return say(at, "users is empty. Leave it out when only you act.");
  const seen = new Set();
  for (const user of users) {
    if (typeof user === "string" && user.toLowerCase() === "you") say(at, 'users: leave out "you". You are the main user and are not listed.');
    else if (typeof user !== "string" || !ROLE.test(user)) say(at, `users: "${user}" is not a role word. Use one lowercase word, like viewer.`);
    else if (seen.has(user)) say(at, `users: "${user}" is listed twice.`);
    seen.add(user);
  }
}

/**
 * @param {unknown} steps
 * @param {Array<string|number>} path
 * @param {Say} say
 * @param {Map<string, {sentence: string, case?: string}>} checks check ids seen so far, across cases
 * @param {string} [caseId]
 */
function checkSteps(steps, path, say, checks, caseId) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return say(path, "steps is missing: list what happens, one line per step, top to bottom.");
  }
  /** @type {Map<string, number>} */
  const here = new Map(); // id -> step number in this list
  steps.forEach((step, i) => {
    const p = [...path, i];
    if (typeof step === "string") {
      if (!isText(step)) say(p, "the step is empty.");
      else checkValues(step, p, say);
      return;
    }
    const isMap = step && typeof step === "object" && !Array.isArray(step);
    if (isMap && step.check === undefined && Object.keys(step).length === 1) {
      // `- Tap Next: then wait` is read by YAML as a field named "Tap Next".
      const [key, value] = Object.entries(step)[0];
      return say(p, `the step has a colon, so it was read as a field. Put the sentence in quotes: - "${key}: ${value ?? ""}"`);
    }
    if (!isMap || step.check === undefined) {
      return say(p, "the step is not a sentence or a check. Write a plain sentence, or check: <sentence> with an id.");
    }
    if (!isText(step.check)) return say(p, "the check has no sentence. Say what must be true at this point.");
    checkValues(step.check, p, say);
    if (step.added !== undefined && typeof step.added !== "boolean") say([...p, "added"], "added must be true or false.");
    if (step.id === undefined || step.id === null) return say(p, `the check "${step.check}" has no id. Every check needs an id, like id: link-on.`);
    if (typeof step.id !== "string") return say([...p, "id"], notText("id", step.id));
    const id = step.id;
    if (!ID.test(id)) return say([...p, "id"], `id "${id}" must be lowercase words joined by dashes, like link-on.`);
    if (here.has(id)) return say([...p, "id"], `id "${id}" is already used by step ${/** @type {number} */ (here.get(id)) + 1}.`);
    here.set(id, i);
    const earlier = checks.get(id);
    if (earlier && earlier.sentence !== step.check) {
      say([...p, "id"], `id "${id}" is used in case "${earlier.case}" for a different check. Two cases can share a check id only when the check says the same thing.`);
    }
    if (!earlier) checks.set(id, { sentence: step.check, case: caseId });
  });
  if (!steps.some((s) => s && typeof s === "object" && s.check !== undefined)) {
    say(path, "there is no check. Add at least one check: line that must be true.");
  }
}

/**
 * Every `${` must open a value written as ${name}.
 * @param {string} text
 * @param {Array<string|number>} path
 * @param {Say} say
 */
function checkValues(text, path, say) {
  let from = text.indexOf("${");
  while (from !== -1) {
    const rest = text.slice(from);
    if (!VALUE.test(rest)) {
      say(path, `"${rest.slice(0, 20).split(" ")[0]}" is not a value. Write values as \${name}, in lowercase with underscores.`);
      return;
    }
    from = text.indexOf("${", from + 2);
  }
}

/** The word after "The <word>" that makes the line about a thing: a quote, or is, has, stays and the like. */
const THING = /^(["'“]|(is|are|was|were|has|have|had|stays|stay|still)$)/i;

/**
 * Warnings, never problems: a line that starts with "The <word> " where word
 * is not in users probably names someone the author forgot to list. Not when
 * the next word is a quote or a form of be, have or stay: "The note "Buy milk"
 * is in the list" and "The list is empty" are about a thing, not a user. An action
 * that starts with a quoted name, like '"Claude Code" joins the project', names
 * whoever acts by name instead of by a role word in users.
 * @param {import("./format.js").Journey} journey
 * @param {(path: Array<string|number>) => string} at "line 9, step 3: " for a path
 * @returns {string[]}
 */
export function warnV1(journey, at) {
  /** @type {string[]} */
  const warnings = [];
  /** @param {unknown} steps @param {Array<string|number>} path @param {string[]} users */
  const scan = (steps, path, users) => {
    if (!Array.isArray(steps)) return;
    steps.forEach((step, i) => {
      const sentence = typeof step === "string" ? step : step?.check;
      const [, subject, next] = (typeof sentence === "string" && sentence.trim().match(/^the ([a-z][a-z0-9_-]*) (\S+)/i)) || [];
      const word = subject?.toLowerCase();
      if (word && !users.includes(word) && !THING.test(next)) {
        warnings.push(`${at([...path, i])}this line starts with "The ${word}", but ${word} is not in users. If the ${word} acts or looks, add them to users.`);
      }
      const name = typeof step === "string" ? step.trim().match(/^"([^"]+)" /)?.[1] : null;
      if (name) warnings.push(`${at([...path, i])}this line starts with "${name}", a name. If "${name}" acts, give it a role word in users, like agent, start the line with "The agent", and say in start who it is.`);
    });
  };
  const top = Array.isArray(journey.users) ? journey.users : [];
  scan(journey.steps, ["steps"], top);
  (Array.isArray(journey.cases) ? journey.cases : []).forEach((c, i) => scan(c?.steps, ["cases", i, "steps"], [...top, ...(Array.isArray(c?.users) ? c.users : [])]));
  return warnings;
}

/** @param {string} field @param {unknown} value */
function notText(field, value) {
  return `${field} ${JSON.stringify(value)} must be text. Put it in quotes, like ${field.split(" ").pop()}: "${value}", or use words, like link-on.`;
}

/** @param {unknown} value @returns {value is string} */
function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** @param {unknown} value */
function isTextList(value) {
  return Array.isArray(value) && value.every(isText);
}
