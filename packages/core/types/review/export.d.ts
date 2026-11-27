/**
 * Write review HTML and the images, videos, and captions it uses to a new folder.
 * @param {string} dir
 * @param {string} out
 * @param {{includeTranscripts?: boolean, mainDir?: string, head?: string}} [options] includeTranscripts: share only when the attached
 *   transcripts have been checked. Each run also gets compare.html, and the folder a compare.html for the whole change.
 *   mainDir: main's runs folder, to compare with in place of the earlier run. head: the commit the change is at now.
 */
export declare function exportReview(dir: string, out: string, { includeTranscripts, mainDir, head }?: {
    includeTranscripts?: boolean;
    mainDir?: string;
    head?: string;
}): string;
