export declare const ID: RegExp;
export type Say = (path: Array<string | number>, message: string) => void;
/**
 * Adds a problem at a path.
 * @typedef {(path: Array<string|number>, message: string) => void} Say
 */
/**
 * @param {import("./format.js").Journey} journey
 * @param {(path: Array<string|number>) => string} at "line 9, step 3: " for a path
 * @returns {string[]}
 */
export declare function validateV1(journey: import("./format.js").Journey, at: (path: Array<string | number>) => string): string[];
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
export declare function warnV1(journey: import("./format.js").Journey, at: (path: Array<string | number>) => string): string[];
