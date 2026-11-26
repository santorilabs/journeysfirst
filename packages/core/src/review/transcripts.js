import { closeSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { FILE_NAME } from "../format/runfile.js";
import { esc } from "../shared/display.js";

const MAX_BYTES = 64 * 1024;

/**
 * Collapsed text for each step number, with 0 for transcripts for the whole run.
 * @param {import("../format/runfile.js").Run} run
 * @param {string} folder
 * @param {{skip?: string, kept?: Array<{file: string, body: string, truncated: boolean}>}} [options]
 *   skip: a file shown some other way. kept: when given, a transcript for the whole run is put here, not in a panel.
 */
export function transcriptPanels(run, folder, { skip, kept } = {}) {
  /** @type {Map<number, string>} */
  const panels = new Map();
  for (const item of Array.isArray(run.media) ? run.media : []) {
    if (item?.kind !== "transcript" || typeof item.file !== "string" || !FILE_NAME.test(item.file) || item.file === skip) continue;
    const text = readText(join(folder, item.file));
    if (text === null) continue;
    const tag = item.tags?.step;
    const step = typeof tag === "number" && Number.isInteger(tag) && tag >= 1 && tag <= run.steps.length ? tag : 0;
    if (!step && kept) {
      kept.push({ file: item.file, ...text });
      continue;
    }
    const panel = `<details class="transcript"><summary>Transcript: ${esc(item.file)}</summary><pre>${esc(text.body)}</pre>${text.truncated ? "<p>Only the first 64 KiB are shown.</p>" : ""}</details>`;
    panels.set(step, (panels.get(step) ?? "") + panel);
  }
  return panels;
}

/**
 * A text file's start. Null when it is not a plain file of text.
 * @param {string} file @param {number} [max] the most bytes to read
 */
export function readText(file, max = MAX_BYTES) {
  try {
    if (!lstatSync(file).isFile()) return null;
    const fd = openSync(file, "r");
    try {
      const data = Buffer.alloc(Math.min(lstatSync(file).size, max) + 1);
      const bytes = readSync(fd, data);
      const body = data.toString("utf8", 0, Math.min(bytes, max));
      return body.includes("\0") ? null : { body, truncated: bytes > max };
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}
