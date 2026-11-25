import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { serveReview } from "../src/review/review.js";
import { recordAllPassed, recorder } from "./helpers.js";

test("review shows only attached transcripts, escaped and collapsed at their step or run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-transcripts-"));
  const recorderRun = recordAllPassed(recorder({ outputDir: dir }));
  recorderRun.attach({ name: "terminal.txt", body: "<script>alert(1)</script> & finished", kind: "transcript", tags: { step: 2 } });
  recorderRun.attach({ name: "handoff.txt", body: "The agent reported back.", kind: "transcript" });
  recorderRun.attach({ name: "unapproved.txt", body: "Do not render this.", kind: "capture" });
  const { folder, run } = recorderRun.finish();
  const external = join(dir, "external.txt");
  writeFileSync(external, "Do not follow this link.");
  symlinkSync(external, join(folder, "linked.txt"));
  const raw = JSON.parse(readFileSync(join(folder, "run.json"), "utf8"));
  raw.media.push({ file: "linked.txt", kind: "transcript" }, { file: "missing.txt", kind: "transcript" });
  writeFileSync(join(folder, "run.json"), JSON.stringify(raw));

  const server = serveReview({ dir, port: 0 });
  await once(server, "listening");
  try {
    const path = `runs/share-by-link/${run.id}`;
    const live = await (await fetch(`http://127.0.0.1:${server.address().port}/${path}`)).text();
    const parent = mkdtempSync(join(tmpdir(), "jf-transcript-export-"));
    const cli = fileURLToPath(new URL("../bin/journeysfirst.js", import.meta.url));
    const out = join(parent, "approved");
    const omitted = join(parent, "omitted");
    execFileSync(process.execPath, [cli, "review", dir, "--out", omitted]);
    execFileSync(process.execPath, [cli, "review", dir, "--out", out, "--include-transcripts"]);
    const exported = readFileSync(join(out, path, "index.html"), "utf8");
    assert.doesNotMatch(readFileSync(join(omitted, path, "index.html"), "utf8"), /Transcript:/);
    for (const html of [live, exported]) {
      assert.match(html, /class="step-card" data-step="2"[^>]*>(?:(?!<\/section>)[\s\S])*<details class="transcript"><summary>Transcript: terminal\.txt<\/summary><pre>&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; finished<\/pre>/);
      assert.match(html, /<\/section>\s*<details class="transcript"><summary>Transcript: handoff\.txt<\/summary><pre>The agent reported back\.<\/pre>/);
      assert.doesNotMatch(html, /<script>alert\(1\)<\/script>|Do not render this|Do not follow this link|Transcript: missing\.txt/);
    }
    assert.equal(existsSync(join(out, path, "assets", "terminal.txt")), false);
  } finally {
    server.close();
  }
});
