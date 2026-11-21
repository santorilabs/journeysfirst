/**
 * The journey file a run belongs to: the one given, or
 * journeys/<name>.journey.yaml in the current folder. journey is null when
 * there is no such file.
 * @param {{journey?: {name?: string}}} run
 * @param {string} [file]
 */
export declare function findJourney(run: {
    journey?: {
        name?: string;
    };
}, file?: string): {
    file: string;
    journey: import("./format.js").Journey | null;
};
/**
 * The run.json in a folder, as stored.
 * @param {string} folder
 * @returns {any} parsed JSON, not yet validated
 */
export declare function readRunJson(folder: string): any;
/**
 * The newest run folder, by started_at, in one journey's folder of runs (like
 * journey-runs/share-by-link), or null when it has none.
 * @param {string} dir
 * @param {(raw: any) => boolean} [keep] which runs count, from their run.json
 * @returns {string|null}
 */
export declare function newestRunFolder(dir: string, keep?: (raw: any) => boolean): string | null;
/**
 * Read a run folder and everything a publish needs from it, checked against
 * the journey when given. Throws when it is not valid or a file it points to
 * is missing.
 *   raw: run.json as it is on disk. publish sends this, and digest covers it.
 *   run: the run as these rules settle it, to show. settled: the ids they settled.
 * The rules can change between versions, so they never touch what is digested.
 * @param {string} folder
 * @param {{journey?: import("./format.js").Journey|null}} [options]
 */
export declare function readRunFolder(folder: string, { journey }?: {
    journey?: import("./format.js").Journey | null;
}): {
    raw: any;
    run: import("./runfile.js").Run;
    settled: string[];
    files: Map<string, NonSharedBuffer>;
    digests: {
        [k: string]: string;
    };
    digest: string;
};
/**
 * Write the settled run.json and its files to <dir>/<journey name>/<run id>/.
 * Refuses a run that fails validation, so a bad run never lands on disk.
 * @param {string} dir
 * @param {import("./runfile.js").Run} raw
 * @param {Map<string, Buffer>} files
 * @param {import("./format.js").Journey} [journey] to check the steps match its lines
 * @returns {{folder: string, run: import("./runfile.js").Run}}
 */
export declare function writeRunFolder(dir: string, raw: import("./runfile.js").Run, files: Map<string, Buffer>, journey?: import("./format.js").Journey): {
    folder: string;
    run: import("./runfile.js").Run;
};
/**
 * Set a run's findings, from a review, in its run.json. Nothing else in the
 * file changes, so a finding can never change a verdict or the result. Refuses
 * anything but findings, a run that is not valid with them, and dropping a
 * finding a person has already made a call on (a review whose `on` is its id).
 * @param {string} folder
 * @param {unknown} given the parsed findings file: {"findings": [...]}
 * @param {{journey?: import("./format.js").Journey|null}} [options]
 * @returns {import("./runfile.js").Run} the run as written
 */
export declare function addFindings(folder: string, given: unknown, { journey }?: {
    journey?: import("./format.js").Journey | null;
}): import("./runfile.js").Run;
/**
 * Add a person's call on a check or a finding to a run's reviews. Nothing else
 * in the file changes: a call never changes a verdict or the result.
 * @param {string} folder
 * @param {{on: string, by: string, says: string, at?: string}} call on: a check id or a finding id. by: the person who made the call.
 * @param {{journey?: import("./format.js").Journey|null}} [options]
 * @returns {import("./runfile.js").Run} the run as written
 */
export declare function addReview(folder: string, { on, by, says, at }: {
    on: string;
    by: string;
    says: string;
    at?: string;
}, { journey }?: {
    journey?: import("./format.js").Journey | null;
}): import("./runfile.js").Run;
