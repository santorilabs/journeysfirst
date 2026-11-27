/** A click that shows nothing for this long is slow, in ms. */
export declare const SLOW_MS = 1000;
export type Tally = Record<string, {
    n: number;
    on: string;
}>;
export type Screen = {
    width: number;
    pageWidth: number;
    text?: string;
    spacing: Tally;
    type: Tally;
    fonts: Tally;
    radius: Tally;
    effects: Tally;
    controls: Array<{
        name: string;
        in: string;
        width: number;
        height: number;
        small?: boolean;
        strong?: boolean;
    }>;
    cut: Array<{
        name: string;
        left: number;
        width: number;
    }>;
};
export type Measure = {
    url?: string;
    wide?: Screen;
    phone?: Screen;
    actions: import("../runner/measure.js").ActionTime[];
};
export type Fact = {
    criterion: string;
    step: number;
    says: string;
    measured: object;
};
/**
 * @typedef {Record<string, {n: number, on: string}>} Tally
 * @typedef {{width: number, pageWidth: number, text?: string, spacing: Tally, type: Tally, fonts: Tally, radius: Tally, effects: Tally,
 *   controls: Array<{name: string, in: string, width: number, height: number, small?: boolean, strong?: boolean}>,
 *   cut: Array<{name: string, left: number, width: number}>}} Screen
 * @typedef {{url?: string, wide?: Screen, phone?: Screen, actions: import("../runner/measure.js").ActionTime[]}} Measure
 * @typedef {{criterion: string, step: number, says: string, measured: object}} Fact
 */
/**
 * The measure files in a run folder, by line number.
 * @param {string} folder
 * @returns {Map<number, Measure>}
 */
export declare function readMeasures(folder: string): Map<number, Measure>;
/**
 * The newest run before this one, of the same journey and case, that was
 * reviewed and has measure files. null when there is none.
 * @param {string} folder a run folder
 * @returns {string|null}
 */
export declare function earlierRun(folder: string): string | null;
/**
 * Every spacing, type size, font and radius these screens use, sorted, as one line.
 * @param {Map<number, Measure>} lines
 */
export declare function valuesUsed(lines: Map<number, Measure>): string;
/**
 * One fact for each thing the measure files show that a criterion names.
 * @param {{lines: Map<number, Measure>, earlier?: Map<number, Measure>|null}} measured
 *   lines: this run. earlier: the earlier reviewed run.
 * @returns {{facts: Fact[], counts: string[], notMeasured: string[], differ: number[]}}
 *   differ: the steps whose screen is not the one the earlier run measured (its words, controls, values or actions).
 */
export declare function measuredFacts({ lines, earlier }: {
    lines: Map<number, Measure>;
    earlier?: Map<number, Measure> | null;
}): {
    facts: Fact[];
    counts: string[];
    notMeasured: string[];
    differ: number[];
};
/**
 * What makes two measurements the same screen: the words, the controls, the values and what each click did.
 * A page the script opened is left out: its paint can land on either side of a line's start.
 * @param {Measure|undefined} measure
 */
export declare const outline: (measure: Measure | undefined) => string;
/** The clicks of a line. A page the script opened is not one. @param {Measure|undefined} measure */
export declare const clicksOf: (measure: Measure | undefined) => import("../runner/measure.js").ActionTime[];
/** The fields a line filled or set. @param {Measure|undefined} measure */
export declare const fieldsOf: (measure: Measure | undefined) => import("../runner/measure.js").ActionTime[];
/**
 * The report `journeysfirst measured` prints for a run folder.
 * @param {string} folder
 */
export declare function measuredReport(folder: string): string;
