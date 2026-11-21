export type MergeLine = {
    journey: string;
    case: string | null;
    ok: boolean;
    says: string;
};
/**
 * @typedef {{journey: string, case: string|null, ok: boolean, says: string}} MergeLine
 */
/**
 * @param {{journeysDir?: string, runsDir?: string, mainDir?: string}} [options]
 * @returns {{ok: boolean, lines: MergeLine[]}}
 */
export declare function mergeCheck({ journeysDir, runsDir, mainDir }?: {
    journeysDir?: string;
    runsDir?: string;
    mainDir?: string;
}): {
    ok: boolean;
    lines: MergeLine[];
};
