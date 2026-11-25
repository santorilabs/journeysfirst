import { copyFileSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FILE_NAME } from "../format/runfile.js";
import { screenshotFile } from "../shared/display.js";
import { captionTrack, indexPage, listRuns, runPage } from "./review.js";

/**
 * Write review HTML and the images, videos, and captions it uses to a new folder.
 * @param {string} dir
 * @param {string} out
 * @param {{includeTranscripts?: boolean}} [options] share only when the attached transcripts have been checked
 */
export function exportReview(dir, out, { includeTranscripts = false } = {}) {
  const root = realpathSync(dir);
  const runs = listRuns(root, { followSymlinks: false });
  const target = resolve(out);
  mkdirSync(target);
  for (const { journey, id, run } of runs) {
    const source = join(root, journey, id);
    const dest = join(target, "runs", journey, id);
    const assets = join(dest, "assets");
    mkdirSync(assets, { recursive: true });
    const files = new Set();
    const tracks = new Map();
    /** @param {string | undefined} name @param {RegExp} extension */
    const copy = (name, extension) => {
      if (!name || !FILE_NAME.test(name) || !extension.test(name)) return false;
      const path = join(source, name);
      if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) return false;
      if (!files.has(name)) copyFileSync(path, join(assets, name));
      files.add(name);
      return true;
    };
    for (const step of run.steps) {
      for (const shot of step.screenshots ?? []) copy(screenshotFile(shot), /\.(png|jpe?g|gif|webp|avif)$/i);
    }
    for (const video of run.media ?? []) {
      if (video.kind !== "video" || typeof video.tags?.user !== "string" || !copy(video.file, /\.(webm|mp4|ogg|ogv)$/i)) continue;
      const vtt = Buffer.from(captionTrack(run.steps, video)).toString("utf8");
      tracks.set(video.file, "data:text/vtt;charset=utf-8," + encodeURIComponent(vtt));
    }
    writeFileSync(join(dest, "index.html"), runPage(run, journey, id, source, {
      includeTranscripts,
      file: (name) => name && files.has(name) ? "assets/" + name : undefined,
      captions: (name) => tracks.get(name),
    }));
  }
  writeFileSync(join(target, "index.html"), indexPage(runs, (journey, id) =>
    `runs/${encodeURIComponent(journey)}/${encodeURIComponent(id)}/index.html`));
  return target;
}
