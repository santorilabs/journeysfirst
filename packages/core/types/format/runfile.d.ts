import { isCheck, screenshotFile } from "../shared/display.js";
export declare const RUN_FORMAT = "journeysfirst-run/v1";
export declare const VERDICTS: string[];
export declare const STEP_STATUSES: string[];
export declare const RESULTS: string[];
export declare const CAUSES: string[];
export declare const LOOKUP: {
    page: string;
    api: string;
    database: string;
    log: string;
    message: string;
    launcher: string;
};
export declare const SOURCES: string[];
export declare const FILE_NAME: RegExp;
export declare const FULL_URL: RegExp;
export type Evidence = {
    source: string;
    login?: string;
    key?: string;
    [field: string]: unknown;
};
export type Screenshot = string | {
    file: string;
    url?: string;
};
export type ActionStep = {
    says: string;
    by: string;
    status: string;
    at?: number;
    took?: number;
    screenshots?: Screenshot[];
    cause?: string;
    reason?: string;
};
export type CheckStep = {
    check: string;
    id: string;
    by: string;
    verdict: string;
    claimed?: string;
    proof?: string;
    evidence?: Evidence[];
    at?: number;
    took?: number;
    screenshots?: Screenshot[];
    cause?: string;
    reason?: string;
    added?: boolean;
    launcher_probe?: string;
};
export type Finding = {
    id: string;
    criterion: string;
    says: string;
    evidence: Evidence[];
    step?: number;
    ask?: string;
};
export type Attempt = {
    status: "complete";
    reason?: string;
} | {
    status: "aborted";
    reason: string;
};
export type Run = {
    format: string;
    id: string;
    journey: {
        name: string;
        version: string;
        case: string | null;
    };
    result: string;
    summary?: string;
    attempt?: Attempt;
    started_at: string;
    finished_at?: string;
    ran_by?: {
        agent?: string;
        model?: string;
    };
    journeysfirst?: string;
    tags?: Record<string, unknown>;
    users?: Record<string, string | null>;
    played_by?: Record<string, string>;
    repeat?: {
        batch: string;
        n: number;
        of: number;
    };
    values?: Record<string, {
        value?: unknown;
        secret?: boolean;
    }>;
    repos?: Array<{
        repo: string;
        commit?: string;
        branch?: string;
    }>;
    media?: import("../shared/display.js").MediaItem[];
    verified?: string[];
    not_verified?: string[];
    findings?: Finding[];
    reviews?: Array<{
        by: string;
        at: string;
        on: string;
        says: string;
    }>;
    steps: Array<ActionStep | CheckStep>;
    [field: string]: unknown;
};
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
export { isCheck, screenshotFile };
/**
 * The verdict that stands: a claimed pass without its proof becomes
 * not_checked, and the claim is kept as `claimed: "passed"`.
 * @param {CheckStep} step
 * @returns {CheckStep}
 */
export declare function settleCheck(step: CheckStep): CheckStep;
/**
 * The whole run's result. failed: any check failed, or an action failed
 * because of the product. passed: every check passed, every action is
 * done, and the attempt did not abort. Otherwise not_fully_checked.
 * @param {Array<ActionStep|CheckStep>} steps
 * @param {Attempt} [attempt]
 */
export declare function runResult(steps: Array<ActionStep | CheckStep>, attempt?: Attempt): "failed" | "not_fully_checked" | "passed";
/**
 * The run as the rules say it stands: every claimed pass without its proof is
 * settled to not_checked, and result, verified and not_verified are worked out
 * from the steps. Also returns the ids it settled.
 * @param {Run} run
 * @returns {{run: Run, settled: string[]}}
 */
export declare function settle(run: Run): {
    run: Run;
    settled: string[];
};
/**
 * Plain sentences for what was verified and what wasn't.
 * @param {Array<ActionStep|CheckStep>} steps
 * @returns {{verified: string[], not_verified: string[]}}
 */
export declare function verifiedLists(steps: Array<ActionStep | CheckStep>): {
    verified: string[];
    not_verified: string[];
};
/**
 * Problems that make a run file unusable. An empty list means it is valid.
 * A claimed pass without its proof is not a problem here: readers settle it
 * (see settle). Pass the journey's plan (journeyPlan) to also check that the
 * steps match the journey's lines, in order.
 * @param {Run} run
 * @param {import("./format.js").Plan} [plan]
 * @returns {string[]}
 */
export declare function validateRun(run: Run, plan?: import("./format.js").Plan): string[];
/**
 * Problems with one step, numbered from 1. users is everyone in the run, when known.
 * @param {unknown} step
 * @param {number} n
 * @param {string[]|null} [users]
 * @returns {string[]}
 */
export declare function stepProblems(step: unknown, n: number, users?: string[] | null): string[];
/**
 * Every file a run refers to: step screenshots and media.
 * @param {Run} run
 * @returns {string[]}
 */
export declare function runFiles(run: Run): string[];
/** @param {Buffer|string} bytes */
export declare function sha256(bytes: Buffer | string): string;
/**
 * The run's content digest: sha256 over the canonical run.json plus each
 * file's sha256. Formatting and key order never change it.
 * @param {Run} run
 * @param {Record<string, string>} fileDigests file name to sha256
 */
export declare function runDigest(run: Run, fileDigests: Record<string, string>): string;
/**
 * A full page address, like https://app.example.test/p/q3-plan.
 * @param {unknown} value
 * @returns {value is string}
 */
export declare const isFullUrl: (value: unknown) => value is string;
