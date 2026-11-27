/** The most questions a comparison asks a person. More than a few and nobody reads them. */
export declare const MAX_QUESTIONS = 3;
/** Every outcome a user can have, worst first, with what a page calls it. */
export declare const OUTCOMES: {
    broke: string;
    worse: string;
    not_verified: string;
    not_compared: string;
    changed: string;
    same: string;
};
export type Run = import("../format/runfile.js").Run;
export type Measure = import("./measured.js").Measure;
export type ToolCall = import("./tool-calls.js").ToolCall;
export type Side = {
    run: Run;
    measures: Map<number, Measure>;
    calls: Map<string, ToolCall[]>;
    folder?: string;
};
export type Item = {
    id: string;
    criterion: string;
    says: string;
    step?: number;
    ask?: string;
    evidence: import("../format/runfile.js").Evidence[];
    kind: "worse" | "changed";
    by: string;
    measured: Record<string, any>;
    calls: Array<{
        by: string;
        at: string;
        says: string;
    }>;
};
export type UserLine = {
    user: string;
    outcome: keyof typeof OUTCOMES;
    says: string;
};
export type StepPair = {
    n: number;
    text: string;
    by?: string;
    isCheck: boolean;
    state?: string;
    items: Item[];
    main: {
        actions: import("../runner/measure.js").ActionTime[];
    };
    change: {
        actions: import("../runner/measure.js").ActionTime[];
    };
};
export type Comparison = {
    why: string | null;
    stale: string | null;
    users: UserLine[];
    items: Item[];
    questions: Item[];
    steps: StepPair[];
    same: number;
    main: Side | null;
    change: Side;
    against: string;
};
/**
 * @param {Side|null} main the run to compare with, or null when there is none
 * @param {Side} change the run of the change
 * @param {{head?: string, why?: string, against?: string, replies?: boolean}} [options] head: the commit the change is at now. why: why there is no run to compare with.
 *   against: what the first run is called. replies: false leaves a tool's reply text out, for a page shared without transcripts.
 * @returns {Comparison}
 */
export declare function compareRuns(main: Side | null, change: Side, { head, why: noMain, against, replies }?: {
    head?: string;
    why?: string;
    against?: string;
    replies?: boolean;
}): Comparison;
/**
 * The run a run of a change is compared with, and what to call it. It is of
 * the same journey, case and journey version, and never the run itself.
 *   With main's runs given: main's newest run. Merging is how a run gets to main, so it needs no call.
 *   Without: the newest earlier run in the same folder from a different commit, so a rerun of the
 *   same code is not what a change is measured against. When every earlier run is from the same
 *   commit, or none says its commit, the newest earlier run.
 *   Either way, a newer earlier run that a person accepted wins.
 * @param {string} folder the run folder of the change
 * @param {string} [mainDir] main's runs folder
 * @returns {{folder: string|null, against: string, why?: string}}
 */
export declare function baselineFor(folder: string, mainDir?: string): {
    folder: string | null;
    against: string;
    why?: string;
};
/**
 * Compare a run folder with its baseline.
 * @param {string} folder the run folder of the change
 * @param {{mainDir?: string, head?: string, replies?: boolean}} [options]
 * @returns {Comparison}
 */
export declare function compareFolder(folder: string, { mainDir, head, replies }?: {
    mainDir?: string;
    head?: string;
    replies?: boolean;
}): Comparison;
/**
 * The newest run of each journey and case in a runs folder, each compared with its baseline.
 * With no folder of main's runs, that is the earlier run in the same folder.
 * @param {string} runsDir
 * @param {{mainDir?: string, head?: string, replies?: boolean}} [options]
 * @returns {Comparison[]}
 */
export declare function compareAll(runsDir: string, options?: {
    mainDir?: string;
    head?: string;
    replies?: boolean;
}): Comparison[];
/**
 * What every comparison here was made against, like "main". "earlier runs" when they differ.
 * @param {Comparison[]} all
 */
export declare const againstOf: (all: Comparison[]) => string;
/**
 * What `journeysfirst compare` prints: each journey, then one line for each user.
 * @param {Comparison[]} all
 * @param {{markdown?: boolean}} [options] markdown: a table for a pull request
 */
export declare function compareReport(all: Comparison[], { markdown }?: {
    markdown?: boolean;
}): string;
/**
 * Write a comparison's items into the run as findings, beside the findings a
 * review wrote. Nothing else in the run changes. A person then answers one with add-review.
 * @param {string} folder the run folder of the change
 * @param {Comparison} comparison
 * @returns {Run} the run as written
 */
export declare function addCompareFindings(folder: string, comparison: Comparison): Run;
