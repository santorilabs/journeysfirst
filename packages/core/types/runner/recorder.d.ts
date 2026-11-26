export { recording } from "./recording.js";
export type Run = import("../format/runfile.js").Run;
export type Evidence = import("../format/runfile.js").Evidence;
export type StepFields = Partial<import("../format/runfile.js").ActionStep & import("../format/runfile.js").CheckStep>;
export type PlanLine = import("../format/format.js").PlanLine;
export type CheckLine = Extract<PlanLine, {
    kind: "check";
}>;
export type Image = Buffer | string;
export type Shot = Image | {
    image: Image;
    url?: string;
};
export type Timing = {
    by?: string;
    at?: number;
    took?: number;
    screenshots?: Shot | Shot[];
    cause?: string;
    reason?: string;
};
export type StartOptions = {
    journey: string | import("../format/format.js").Journey;
    file?: string;
    name?: string;
    case?: string | null;
    ranBy?: {
        agent?: string;
        model?: string;
    };
    users?: Record<string, string | null>;
    playedBy?: Record<string, string>;
    repeat?: {
        batch: string;
        n: number;
        of: number;
    };
    tags?: Record<string, unknown>;
    repos?: Array<{
        repo: string;
        commit?: string;
        branch?: string;
    }>;
    outputDir?: string;
    id?: string;
    now?: () => number;
};
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
export declare class RunRecorder {
    #private;
    file: string | null;
    journey: import("../format/format.js").Journey;
    /** @type {string} */
    name: string;
    plan: import("../format/format.js").Plan;
    outputDir: string;
    now: () => number;
    startMs: number;
    id: string;
    ranBy: {
        agent: string | undefined;
        model: string | undefined;
    };
    /** @type {Record<string, string|null>} */
    users: Record<string, string | null>;
    /** @type {Record<string, string>} */
    played: Record<string, string>;
    /** One of several runs of this journey, when it is: {batch, n, of}. */
    repeat: {
        batch: string;
        n: number;
        of: number;
    } | undefined;
    /** @type {Record<string, unknown>} */
    tags: Record<string, unknown>;
    repos: {
        repo: string;
        commit?: string;
        branch?: string;
    }[];
    /** @type {NonNullable<Run["values"]>} */
    values: NonNullable<Run["values"]>;
    /** @type {import("../shared/display.js").MediaItem[]} */
    media: import("../shared/display.js").MediaItem[];
    /** @type {Map<number, StepFields>} line number to its recorded step */
    recorded: Map<number, StepFields>;
    /** @type {Map<string, Buffer>} */
    files: Map<string, Buffer>;
    /** @param {StartOptions} options journey is a path to a journey file, or a parsed journey (then pass file or name) */
    static start(options: StartOptions): RunRecorder;
    /** @param {StartOptions} options */
    constructor({ journey, file, name, case: caseId, ranBy, users, playedBy, repeat, tags, repos, outputDir, id, now }: StartOptions);
    /** Seconds since the run started. */
    elapsed(): number;
    /**
     * The account a user used in this run.
     * @param {string} name
     * @param {string|null} [account]
     */
    user(name: string, account?: string | null): void;
    /**
     * Who played a user in this run, as launched: "a script", or the agent, its version and model, like "Claude Code 2.4.1, opus".
     * @param {string} name
     * @param {string} who
     */
    playedBy(name: string, who: string): void;
    /**
     * Throws unless name is "you" or a user in this journey.
     * @param {string} [name]
     */
    knows(name?: string): void;
    /**
     * The value a `${name}` had in this run. A secret's value is never written:
     * the run says only that it was secret, and the run is refused if the value
     * shows up anywhere else in it.
     * @param {string} name
     * @param {unknown} value
     * @param {{secret?: boolean}} [options]
     */
    value(name: string, value: unknown, { secret }?: {
        secret?: boolean;
    }): void;
    /**
     * Secret values still in memory, longest first. For a screenshot and a
     * trace. Nothing here is written into the run file.
     * @returns {string[]}
     */
    secretValues(): string[];
    /**
     * A fact about this run to filter on, like environment or device.
     * @param {string} key
     * @param {unknown} value
     */
    tag(key: string, value: unknown): void;
    /**
     * Add a video, recording or other file to the run's media.
     * @param {{name: string, body?: Buffer|string, path?: string, kind: string, starts_at?: number, tags?: Record<string, unknown>}} item
     */
    attach({ name, body, path, kind, starts_at, tags }: {
        name: string;
        body?: Buffer | string;
        path?: string;
        kind: string;
        starts_at?: number;
        tags?: Record<string, unknown>;
    }): string;
    /**
     * Text with each secret's value replaced by its `${name}`, for a file the
     * run attaches. result() checks run.json and attached transcripts for secrets.
     * @param {string} text
     */
    redact(text: string): string;
    /** @param {string[]} values exact host values to mask in recorded text, not in the run's structural fields */
    redactOutputValues(values: string[]): void;
    /**
     * Record an action line.
     * @param {number|string} line the line number (from 1) or the action's sentence
     * @param {Timing & {status?: "done"|"failed"|"blocked"|"not_run"}} result
     */
    step(line: number | string, { by, status, ...rest }?: Timing & {
        status?: "done" | "failed" | "blocked" | "not_run";
    }): void;
    /**
     * Record a check. A claimed pass stands only with evidence from the login of
     * the user in by; otherwise it becomes not_checked. A failed check means
     * the product did the wrong thing, so its cause is product unless you say.
     * @param {string} id the check's id from the journey
     * @param {Timing & {verdict?: "passed"|"failed"|"blocked"|"not_checked", proof?: string, evidence?: Evidence[]}} result
     */
    check(id: string, { by, verdict, proof, evidence, cause, ...rest }?: Timing & {
        verdict?: "passed" | "failed" | "blocked" | "not_checked";
        proof?: string;
        evidence?: Evidence[];
    }): void;
    /**
     * Mark a line blocked: setup or the environment broke, so it couldn't be done.
     * Checks after it that have no verdict of their own are blocked too.
     * @param {number|string} line a line number, an action's sentence, or a check id
     * @param {{reason: string, cause?: "environment"|"test"|"product", by?: string}} why
     */
    blocked(line: number | string, { reason, cause, by }: {
        reason: string;
        cause?: "environment" | "test" | "product";
        by?: string;
    }): void;
    /**
     * The run file and its files, without writing anything. Throws when a
     * secret value appears in the run metadata or an attached transcript.
     * @param {{summary?: string, attempt?: Run["attempt"]}} [options]
     * @returns {{run: Run, files: Map<string, Buffer>}}
     */
    result({ summary, attempt }?: {
        summary?: string;
        attempt?: Run["attempt"];
    }): {
        run: Run;
        files: Map<string, Buffer>;
    };
    /**
     * Finish and write the run folder: <outputDir>/<journey name>/<run id>/.
     * @param {{summary?: string, attempt?: Run["attempt"]}} [options]
     * @returns {{folder: string, run: Run}}
     */
    finish(options?: {
        summary?: string;
        attempt?: Run["attempt"];
    }): {
        folder: string;
        run: Run;
    };
    /**
     * The journey line for an action: its line number (from 1) or its sentence.
     * @param {number|string} line
     */
    actionLine(line: number | string): {
        kind: "action";
        n: number;
        says: string;
    };
    /**
     * The journey line for a check id.
     * @param {string} id
     */
    checkLine(id: string): {
        kind: "check";
        n: number;
        check: string;
        id: string;
        added?: boolean;
        launcher_probe?: string;
    };
}
/** The repo in the current folder, as run results `repos`. Empty outside git. */
export declare function currentRepos(): {
    repo: string;
    commit: string;
    branch: string;
}[];
/** A run id like 2026-11-08-1802-7d2e91fa: the start time in UTC, then 8 random hex. */
/** @param {number} ms */
export declare function runId(ms: number): string;
