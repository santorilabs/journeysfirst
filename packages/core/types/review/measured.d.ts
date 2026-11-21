/** The line in journeys/README.md that lists the values the running product uses. */
export declare const MEASURED_LINE = "Measured in the running product:";
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
    ask?: true;
};
export type Known = Record<"spacing" | "type" | "fonts" | "radius", Set<string>>;
/**
 * @typedef {Record<string, {n: number, on: string}>} Tally
 * @typedef {{width: number, pageWidth: number, text?: string, spacing: Tally, type: Tally, fonts: Tally, radius: Tally, effects: Tally,
 *   controls: Array<{name: string, in: string, width: number, height: number, small?: boolean, strong?: boolean}>,
 *   cut: Array<{name: string, left: number, width: number}>}} Screen
 * @typedef {{url?: string, wide?: Screen, phone?: Screen, actions: import("../runner/measure.js").ActionTime[]}} Measure
 * @typedef {{criterion: string, step: number, says: string, measured: object, ask?: true}} Fact ask: a person decides,
 *   because nothing says whether it is new
 * @typedef {Record<"spacing"|"type"|"fonts"|"radius", Set<string>>} Known
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
 * The values a README's measured line lists, or null when it has no such line
 * or the line holds no values yet.
 * @param {string} text journeys/README.md
 * @returns {Known|null}
 */
export declare function knownValues(text: string): Known | null;
/**
 * The measured line for these screens, added to what is already known.
 * @param {Map<number, Measure>} lines
 * @param {{known?: Known|null, leaveOut?: Set<string>}} [options] leaveOut: values a fact calls new, like "spacing 11".
 *   They join the line only when a person says they are right.
 */
export declare function measuredLine(lines: Map<number, Measure>, { known, leaveOut }?: {
    known?: Known | null;
    leaveOut?: Set<string>;
}): string;
/**
 * One fact for each thing the measure files show that a criterion names.
 * @param {{lines: Map<number, Measure>, earlier?: Map<number, Measure>|null, known?: Known|null}} measured
 *   lines: this run. earlier: the earlier reviewed run. known: the README's measured line.
 * @returns {{facts: Fact[], counts: string[], notMeasured: string[], fresh: Set<string>, differ: number[]}}
 *   fresh: each value a foundation-values fact calls new, like "spacing 11".
 *   differ: the steps whose screen is not the one the earlier run measured (its words, controls, values or actions).
 */
export declare function measuredFacts({ lines, earlier, known }: {
    lines: Map<number, Measure>;
    earlier?: Map<number, Measure> | null;
    known?: Known | null;
}): {
    facts: Fact[];
    counts: string[];
    notMeasured: string[];
    fresh: Set<string>;
    differ: number[];
};
/**
 * The report `journeysfirst measured` prints for a run folder.
 * @param {string} folder
 * @param {{readme?: string}} [options] readme: the path of journeys/README.md
 */
export declare function measuredReport(folder: string, { readme }?: {
    readme?: string;
}): string;
