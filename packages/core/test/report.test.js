import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { summaryMarkdown, writeReport } from "../src/review/report.js";
import { VIEWER_SAW, recordAllPassed, recorder } from "./helpers.js";

const BIN = new URL("../bin/journeysfirst.js", import.meta.url).pathname;
const REASON = "left | right <script>alert(1)</script>";

test("report.html shows the result and screenshots, and does not copy video bytes", () => {
  const { folder, run } = failedRun();
  const html = readFileSync(writeReport(folder), "utf8");
  assert.match(html, /<h1>share-by-link<\/h1>/);
  assert.match(html, /class="state failed"/);
  assert.match(html, /src="step-1.png"/);
  assert.match(html, /viewer-blocked/);
  assert.ok(html.includes("left | right &lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("VIDEO-BYTES-NOT-IN-REPORT"), false);
  assert.match(html, /href="you.webm"/);
  const md = summaryMarkdown(run);
  assert.match(md, /^## share-by-link: Failed\n/);
  assert.ok(md.includes("| viewer-blocked | Failed | left \\| right <script>alert(1)</script> |"));
  assert.equal(md.includes("VIDEO-BYTES-NOT-IN-REPORT"), false);
  assert.equal(md.includes("step-1.png"), false, "the summary names checks, not image files");
});

test("the CLI writes report.html and prints the summary", () => {
  const { folder } = failedRun();
  const report = spawnSync(process.execPath, [BIN, "report", folder], { encoding: "utf8" });
  assert.equal(report.status, 0, report.stdout + report.stderr);
  assert.equal(report.stdout.trim(), join(folder, "report.html"));
  assert.match(readFileSync(join(folder, "report.html"), "utf8"), /share-by-link/);
  const summary = spawnSync(process.execPath, [BIN, "summary", folder], { encoding: "utf8" });
  assert.equal(summary.status, 0, summary.stdout + summary.stderr);
  assert.match(summary.stdout, /^## share-by-link: Failed/);
  assert.equal(summary.stdout.includes("VIDEO-BYTES-NOT-IN-REPORT"), false);
  const missing = spawnSync(process.execPath, [BIN, "report", join(folder, "missing")], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /is not a run folder: it has no run\.json/);
  const help = spawnSync(process.execPath, [BIN, "--help"], { encoding: "utf8" });
  assert.match(help.stdout, /journeysfirst report <run folder>/);
  assert.match(help.stdout, /journeysfirst summary <run folder>/);
});

function failedRun() {
  const dir = mkdtempSync(join(tmpdir(), "jf-report-"));
  const run = recordAllPassed(recorder({ outputDir: dir }));
  run.attach({ name: "you.webm", body: "VIDEO-BYTES-NOT-IN-REPORT", kind: "video", starts_at: 0, tags: { user: "you" } });
  run.check("viewer-blocked", {
    by: "viewer",
    verdict: "failed",
    proof: "Opened the link again.",
    evidence: [VIEWER_SAW],
    reason: REASON,
  });
  return run.finish();
}
