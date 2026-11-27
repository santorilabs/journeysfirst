export type MediaItem = import("../shared/display.js").MediaItem;
export type StepFields = import("./review.js").StepFields;
/**
 * Each line in a video as a WebVTT captions track: from its time in the video
 * to the next line's, or to its own end for the last. In a paced video a line
 * stays at least half a second.
 * @param {StepFields[]} steps
 * @param {MediaItem} video
 * @returns {string}
 */
export declare function captionTrack(steps: StepFields[], video: MediaItem): string;
/**
 * Where the player holds a video that recorded with no waiting: just before each
 * line ends, for as long as a paced run waits there. Undefined for a paced video.
 * @param {StepFields[]} steps
 * @param {MediaItem} video
 * @param {(name: string | undefined) => string | undefined} fileUrl
 * @returns {import("./player.js").Hold[] | undefined}
 */
export declare function videoHolds(steps: StepFields[], video: MediaItem, fileUrl: (name: string | undefined) => string | undefined): import("./player.js").Hold[] | undefined;
