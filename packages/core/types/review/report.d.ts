/**
 * Write report.html into a run folder. Returns the file's path.
 * @param {string} folder
 * @returns {string}
 */
export declare function writeReport(folder: string): string;
/**
 * The run as one HTML page. Screenshot images are relative paths in the same folder.
 * @param {import("../format/runfile.js").Run} run
 * @returns {string}
 */
export declare function reportHtml(run: import("../format/runfile.js").Run): string;
/**
 * Markdown for a GitHub pull request comment. Text only: no images, video or traces.
 * @param {import("../format/runfile.js").Run} run
 * @returns {string}
 */
export declare function summaryMarkdown(run: import("../format/runfile.js").Run): string;
