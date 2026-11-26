/**
 * Collapsed text for each step number, with 0 for transcripts for the whole run.
 * @param {import("../format/runfile.js").Run} run
 * @param {string} folder
 * @param {{skip?: string, kept?: Array<{file: string, body: string, truncated: boolean}>}} [options]
 *   skip: a file shown some other way. kept: when given, a transcript for the whole run is put here, not in a panel.
 */
export declare function transcriptPanels(run: import("../format/runfile.js").Run, folder: string, { skip, kept }?: {
    skip?: string;
    kept?: Array<{
        file: string;
        body: string;
        truncated: boolean;
    }>;
}): Map<number, string>;
/**
 * A text file's start. Null when it is not a plain file of text.
 * @param {string} file @param {number} [max] the most bytes to read
 */
export declare function readText(file: string, max?: number): {
    body: string;
    truncated: boolean;
} | null;
