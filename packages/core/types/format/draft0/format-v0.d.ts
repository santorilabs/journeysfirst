export declare const FORMAT = "journeysfirst/v0";
export declare const NEEDS: string[];
export type V0Step = {
    id: string;
    says: string;
};
export type V0Outcome = {
    id: string;
    after: string;
    says: string;
    needs?: string[];
};
export type V0Journey = {
    format: string;
    id: string;
    title: string;
    start: string;
    people: Record<string, unknown>;
    steps: V0Step[];
    outcomes: V0Outcome[];
};
/**
 * @typedef {{id: string, says: string}} V0Step
 * @typedef {{id: string, after: string, says: string, needs?: string[]}} V0Outcome
 * @typedef {{format: string, id: string, title: string, start: string, people: Record<string, unknown>, steps: V0Step[], outcomes: V0Outcome[]}} V0Journey
 */
/**
 * @param {V0Journey} journey
 * @returns {string[]} problems; empty means valid
 */
export declare function validateJourney(journey: V0Journey): string[];
/**
 * A hash of the sentences only, unchanged from draft 0 so old versions still match.
 * @param {V0Journey} journey
 */
export declare function journeyVersion(journey: V0Journey): string;
/**
 * Draft 0 as v1 lines: each step is an action, followed by the outcomes that come after it as checks.
 * @param {V0Journey} journey
 */
export declare function toLines(journey: V0Journey): {
    people: string[];
    lines: ({
        kind: "action";
        says: string;
    } | {
        kind: "check";
        check: string;
        id: string;
    })[];
};
