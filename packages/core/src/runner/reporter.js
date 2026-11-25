// Playwright reporter: writes each journey run to a folder.
//   journey-runs/<journey name>/<run id>/run.json   (run results v1, see runfile.js)
//   journey-runs/<journey name>/<run id>/step-<n>.png
//   journey-runs/<journey name>/<run id>/<user>.webm
//   journey-runs/<journey name>/<run id>/trace.zip   (a run that did not pass, with Playwright's trace on)
// With --repeat-each=N, the N runs of one test share repeat.batch, with n and of:
// {batch, n: 3, of: 5}. The review page shows them together, as "4 of 5 passed".
// ran_by and tags.environment come from JOURNEYSFIRST_AGENT, JOURNEYSFIRST_MODEL
// and JOURNEYSFIRST_ENV (see recorder.js).
import { FILE_ATTACHMENT, RUN_ATTACHMENT, SECRET_ATTACHMENT } from "./playwright.js";
import { redactZip } from "./mask.js";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { writeRunFolder } from "../format/run-folder.js";

export default class JourneyReporter {
  /** @param {{outputDir?: string}} [options] */
  constructor({ outputDir = "journey-runs" } = {}) {
    this.outputDir = outputDir;
    /** @type {string[]} */
    this.written = [];
    /** One batch id per test in this invocation. @type {Map<string, string>} */
    this.batches = new Map();
  }

  /**
   * @param {import("@playwright/test/reporter").TestCase} test
   * @param {import("@playwright/test/reporter").TestResult} result
   */
  onTestEnd(test, result) {
    const runAttachment = result.attachments.find((a) => a.name === RUN_ATTACHMENT);
    if (!runAttachment?.body) return;
    const files = new Map();
    for (const attachment of result.attachments) {
      if (attachment.name.startsWith(FILE_ATTACHMENT) && attachment.body) {
        files.set(attachment.name.slice(FILE_ATTACHMENT.length), attachment.body);
      }
    }
    const run = JSON.parse(runAttachment.body.toString());
    keepTraces(run, files, result.attachments, secretList(result.attachments));
    const of = test.parent.project()?.repeatEach ?? 1;
    if (of > 1) run.repeat = { batch: this.batch(test), n: test.repeatEachIndex + 1, of };
    this.written.push(writeRunFolder(this.outputDir, run, files).folder);
  }

  /** @param {import("@playwright/test/reporter").TestCase} test */
  batch(test) {
    const key = test.titlePath().join(" > ");
    if (!this.batches.has(key)) this.batches.set(key, randomUUID().slice(0, 8));
    return /** @type {string} */ (this.batches.get(key));
  }

  onEnd() {
    for (const folder of this.written) console.log(`journeysfirst: wrote ${folder}/run.json`);
  }

  printsToStdio() {
    return false;
  }
}

/**
 * Copy Playwright's trace into a run that did not pass, listed in media as
 * kind "trace". With trace: "retain-on-failure" Playwright keeps one only for
 * a failed test, and a journey test fails whenever its run did not pass. One
 * trace covers every user's browser context. A passing run never keeps one,
 * even with trace: "on".
 * @param {any} run
 * @param {Map<string, Buffer>} files
 * @param {import("@playwright/test/reporter").TestResult["attachments"]} attachments
 * @param {string[]} secrets
 */
function keepTraces(run, files, attachments, secrets) {
  if (run.result === "passed") return;
  const traces = attachments.filter((a) => a.name === "trace" && a.path);
  traces.forEach((trace, i) => {
    const file = i === 0 ? "trace.zip" : `trace-${i + 1}.zip`;
    files.set(file, redactZip(readFileSync(/** @type {string} */ (trace.path)), secrets));
    run.media = [...(run.media ?? []), { file, kind: "trace" }];
  });
}

/**
 * Declared secret values the test attached for the trace only. The file is
 * removed so the value does not stay in Playwright's output.
 * @param {import("@playwright/test/reporter").TestResult["attachments"]} attachments
 * @returns {string[]}
 */
function secretList(attachments) {
  const found = attachments.find((attachment) => attachment.name === SECRET_ATTACHMENT);
  if (!found) return [];
  try {
    const body = found.body ?? (found.path ? readFileSync(found.path) : null);
    if (found.path) rmSync(found.path, { force: true });
    if (!body) return [];
    const list = JSON.parse(body.toString());
    return Array.isArray(list) ? list.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}
