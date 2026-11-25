import { closeSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { FILE_NAME } from "../format/runfile.js";
import { esc } from "../shared/display.js";

const MAX_BYTES = 64 * 1024;

/**
 * Collapsed text for each step number, with 0 for transcripts for the whole run.
 * @param {import("../format/runfile.js").Run} run
 * @param {string} folder
 */
export function transcriptPanels(run, folder) {
  /** @type {Map<number, string>} */
  const panels = new Map();
  for (const item of Array.isArray(run.media) ? run.media : []) {
    if (item?.kind !== "transcript" || typeof item.file !== "string" || !FILE_NAME.test(item.file)) continue;
    const text = readTranscript(join(folder, item.file));
    if (text === null) continue;
    const tag = item.tags?.step;
    const step = typeof tag === "number" && Number.isInteger(tag) && tag >= 1 && tag <= run.steps.length ? tag : 0;
    const panel = `<details class="transcript"><summary>Transcript: ${esc(item.file)}</summary><pre>${esc(text.body)}</pre>${text.truncated ? "<p>Only the first 64 KiB are shown.</p>" : ""}</details>`;
    panels.set(step, (panels.get(step) ?? "") + panel);
  }
  return panels;
}

/** @param {string} file */
function readTranscript(file) {
  try {
    if (!lstatSync(file).isFile()) return null;
    const fd = openSync(file, "r");
    try {
      const data = Buffer.alloc(MAX_BYTES + 1);
      const bytes = readSync(fd, data);
      const body = data.toString("utf8", 0, Math.min(bytes, MAX_BYTES));
      return body.includes("\0") ? null : { body, truncated: bytes > MAX_BYTES };
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}
