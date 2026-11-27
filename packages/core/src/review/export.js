import { copyFileSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FILE_NAME } from "../format/runfile.js";
import { screenshotFile } from "../shared/display.js";
import { compareAll, compareFolder } from "./compare.js";
import { changePage, comparePage } from "./compare-page.js";
import { indexPage, listRuns, runPage } from "./review.js";
import { captionTrack } from "./video-lines.js";

const IMAGE = /\.(png|jpe?g|gif|webp|avif)$/i;

/**
 * Write review HTML and the images, videos, and captions it uses to a new folder.
 * @param {string} dir
 * @param {string} out
 * @param {{includeTranscripts?: boolean, mainDir?: string, head?: string}} [options] includeTranscripts: share only when the attached
 *   transcripts have been checked. mainDir: main's runs folder. With it, each run also gets compare.html, and the folder a compare.html
 *   for the whole change. head: the commit the change is at now.
 */
export function exportReview(dir, out, { includeTranscripts = false, mainDir, head } = {}) {
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
    /** @param {string | undefined} name @param {RegExp} extension @param {string} [from] the run folder it is in @param {string} [prefix] */
    const copy = (name, extension, from = source, prefix = "") => {
      if (!name || !FILE_NAME.test(name) || !extension.test(name)) return false;
      const path = join(from, name);
      if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) return false;
      if (!files.has(prefix + name)) copyFileSync(path, join(assets, prefix + name));
      files.add(prefix + name);
      return true;
    };
    for (const step of run.steps) {
      for (const shot of step.screenshots ?? []) copy(screenshotFile(shot), IMAGE);
    }
    if (mainDir && !run.legacy) {
      const compared = compareFolder(source, { mainDir: resolve(mainDir), head });
      writeFileSync(join(dest, "compare.html"), comparePage(compared, {
        file: (name) => name && files.has(name) ? "assets/" + name : undefined,
        mainFile: (name) => compared.main?.folder && copy(name, IMAGE, compared.main.folder, "main-") ? "assets/main-" + name : undefined,
        run: "index.html", all: "../../../compare.html", shown: run,
      }));
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
  if (mainDir) {
    const shown = new Map(runs.map(({ journey, id, run }) => [join(root, journey, id), run]));
    writeFileSync(join(target, "compare.html"), changePage(compareAll(root, { mainDir: resolve(mainDir), head }),
      (c) => `runs/${encodeURIComponent(c.change.run.journey.name)}/${encodeURIComponent(c.change.run.id)}/compare.html`, (c) => shown.get(c.change.folder ?? "")));
  }
  return target;
}
