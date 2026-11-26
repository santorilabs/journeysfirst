export declare const FORMAT = "journeysfirst/v1";
export declare const FORMAT_V0 = "journeysfirst/v0";
export type V0Journey = import("./draft0/format-v0.js").V0Journey;
export type Line = string | {
    check: string;
    id: string;
    added?: boolean;
    launcher_probe?: string;
    [field: string]: unknown;
};
export type Case = {
    name: string;
    id: string;
    start: string;
    steps: Line[];
    users?: string[];
    setup?: string;
    added?: boolean;
};
export type Journey = {
    format: string;
    title: string;
    promise: string;
    users?: string[];
    start?: string;
    setup?: string;
    steps?: Line[];
    cases?: Case[];
    notes?: string;
    [field: string]: unknown;
};
export type PlanLine = {
    kind: "action";
    n: number;
    says: string;
} | {
    kind: "check";
    n: number;
    check: string;
    id: string;
    added?: boolean;
    launcher_probe?: string;
};
export type Plan = {
    version: string;
    case: string | null;
    everyone: string[];
    lines: PlanLine[];
};
/**
 * @param {string} text
 * @returns {Journey}
 */
export declare function parseJourney(text: string): Journey;
/**
 * @param {string} path
 * @returns {Journey}
 */
export declare function loadJourney(path: string): Journey;
/**
 * The journey's name: its file name without `.journey.yaml`.
 * @param {string} path
 */
export declare function journeyName(path: string): string;
/**
 * Problems that make a journey unusable. An empty list means it is valid.
 * Each problem names the line and step it points at, when the journey was parsed from text.
 * @param {Journey} journey
 * @returns {string[]}
 */
export declare function validateJourney(journey: Journey): string[];
/**
 * Things that are allowed but probably wrong, such as a line that starts with
 * "The admin" when admin is not in users. They never make a journey invalid.
 * @param {Journey} journey
 * @returns {string[]}
 */
export declare function journeyWarnings(journey: Journey): string[];
/**
 * The journey's version: a hash of what the journey promises. notes (hints for
 * runners) and fields a tool or team added (tags, anything unknown) never
 * change it.
 * @param {Journey} journey
 */
export declare function journeyVersion(journey: Journey): string;
/**
 * The case ids of a journey, or [] when it has none.
 * @param {Journey} journey
 * @returns {string[]}
 */
export declare function caseIds(journey: Journey): string[];
/**
 * The lines of one run of a journey, in order, numbered from 1, and everyone in it.
 * A journey with cases needs the case id; one without takes null.
 * @param {Journey} journey
 * @param {string|null} [caseId]
 * @returns {Plan}
 */
export declare function journeyPlan(journey: Journey, caseId?: string | null): Plan;
