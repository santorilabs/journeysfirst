/**
 * The run's problems as stored, and the run as the rules say it stands. A
 * valid run with nothing to settle comes back unchanged, so the runner's own
 * words in not_verified are kept.
 * @param {import("./runfile.js").Run} raw
 * @param {import("./format.js").Journey} [journey]
 * @returns {{run: import("./runfile.js").Run, settled: string[], problems: string[]}}
 */
export declare function checkRun(raw: import("./runfile.js").Run, journey?: import("./format.js").Journey): {
    run: import("./runfile.js").Run;
    settled: string[];
    problems: string[];
};
