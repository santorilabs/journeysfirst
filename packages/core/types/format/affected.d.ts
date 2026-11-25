/**
 * @param {string} root repo root
 * @param {string[]} paths paths that changed, from the repo root
 * @returns {{selected: string[], skipped: string[]}} journey files, relative to root
 */
export declare function affectedJourneys(root: string, paths: string[]): {
    selected: string[];
    skipped: string[];
};
/**
 * One line per journey: `run <file>` or `skip <file>`.
 * @param {string} root
 * @param {string[]} paths
 * @returns {string[]}
 */
export declare function affectedLines(root: string, paths: string[]): string[];
/**
 * True when a covered-by pattern matches a changed path.
 * `docs/**` matches `docs` and anything inside it. A `*` matches within one path segment.
 * @param {string} pattern
 * @param {string} file
 * @returns {boolean}
 */
export declare function pathCovers(pattern: string, file: string): boolean;
