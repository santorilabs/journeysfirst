export type Request = import("node:http").IncomingMessage;
export type Response = import("node:http").ServerResponse;
export type MediaItem = import("../shared/display.js").MediaItem;
export type Run = import("../format/runfile.js").Run;
export type Finding = import("../format/runfile.js").Finding;
export type StepFields = Partial<import("../format/runfile.js").ActionStep & import("../format/runfile.js").CheckStep>;
export type ShownRun = Run & {
    journey: {
        title?: string;
    };
    promise?: string;
    legacy?: boolean;
    problems?: string[];
};
export type RunEntry = {
    journey: string;
    id: string;
    run: ShownRun;
};
export type AppReport = {
    line: number;
    summary: string;
    users: Array<{
        user: string;
        outline: string | null;
        requests: Array<{
            line: number | null;
            method: string;
            path: string;
            status: number;
        }>;
        errors: Array<{
            line: number | null;
            text: string;
        }>;
        more?: {
            requests?: number;
            errors?: number;
        };
    }>;
};
/**
 * @typedef {import("node:http").IncomingMessage} Request
 * @typedef {import("node:http").ServerResponse} Response
 * @typedef {import("../shared/display.js").MediaItem} MediaItem
 * @typedef {import("../format/runfile.js").Run} Run
 * @typedef {import("../format/runfile.js").Finding} Finding
 * @typedef {Partial<import("../format/runfile.js").ActionStep & import("../format/runfile.js").CheckStep>} StepFields an action or a check, field by field
 * @typedef {Run & {journey: {title?: string}, promise?: string, legacy?: boolean, problems?: string[]}} ShownRun a run as the page shows it
 * @typedef {{journey: string, id: string, run: ShownRun}} RunEntry
 * @typedef {{line: number, summary: string, users: Array<{user: string, outline: string|null,
 *   requests: Array<{line: number|null, method: string, path: string, status: number}>,
 *   errors: Array<{line: number|null, text: string}>, more?: {requests?: number, errors?: number}}>}} AppReport
 *   failure.json, written by the runner when a run fails (see src/runner/reported.js)
 */
/**
 * Listens on 127.0.0.1 unless you pass another host, so the runs stay on this machine.
 * @param {{dir?: string, port?: number, host?: string}} [options]
 */
export declare function serveReview({ dir, port, host }?: {
    dir?: string;
    port?: number;
    host?: string;
}): import("node:http").Server<typeof import("node:http").IncomingMessage, typeof import("node:http").ServerResponse>;
/**
 * Every run folder under root, newest first, in v1 terms.
 * @param {string} root
 * @param {{followSymlinks?: boolean}} [options]
 * @returns {RunEntry[]}
 */
export declare function listRuns(root: string, { followSymlinks }?: {
    followSymlinks?: boolean;
}): RunEntry[];
/**
 * A run as the rules say it stands, never as stored (see checkRun). Problems
 * from validation (against the journey when journeys/<name>.journey.yaml is
 * found) are kept to show on the page.
 * @param {any} raw a parsed run.json, not yet validated
 * @returns {ShownRun}
 */
export declare function forDisplay(raw: any): ShownRun;
/**
 * A draft 0 run file (it has outcomes) in v1 field names, for display only:
 * each step is an action, followed by its outcomes as checks.
 * @param {any} run a parsed draft 0 run.json
 * @returns {ShownRun}
 */
export declare function fromLegacy(run: any): ShownRun;
/** @param {RunEntry[]} runs @param {(journey: string, id: string) => string} runUrl */
export declare function indexPage(runs: RunEntry[], runUrl?: (journey: string, id: string) => string): string;
/**
 * @param {ShownRun} run
 * @param {string} journey
 * @param {string} id
 * @param {string} folder the run folder on disk, to say where its trace is
 * @param {{file: (name: string | undefined) => string | undefined, captions: (name: string) => string | undefined, includeTranscripts?: boolean}} [assets] approved exported assets
 */
export declare function runPage(run: ShownRun, journey: string, id: string, folder: string, assets?: {
    file: (name: string | undefined) => string | undefined;
    captions: (name: string) => string | undefined;
    includeTranscripts?: boolean;
}): string;
