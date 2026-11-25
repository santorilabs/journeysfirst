/**
 * Write review HTML and the images, videos, and captions it uses to a new folder.
 * @param {string} dir
 * @param {string} out
 * @param {{includeTranscripts?: boolean}} [options] share only when the attached transcripts have been checked
 */
export declare function exportReview(dir: string, out: string, { includeTranscripts }?: {
    includeTranscripts?: boolean;
}): string;
