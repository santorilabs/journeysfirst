import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "journeysfirst/playwright";
import { REPO, binOf, freePort, install, linkProject, markTime, newestRun, packs, playwrightOf, run, show } from "./support.js";

const broken = process.env.JF_BROKEN === "main";

// A tiny app where the viewer is refused: the doc's data answers 403.
const APP = `import { createServer } from "node:http";
const port = Number(process.env.JOURNEYS_PORT);
createServer((req, res) => {
  if (req.url.startsWith("/api/doc")) return void res.writeHead(403, { "content-type": "application/json" }).end('{"error":"Sign in to see this doc."}');
  res.writeHead(200, { "content-type": "text/html" }).end(\`<!doctype html><title>Doc</title><h1>Loading</h1><script>
fetch("/api/doc/q3").then((r) => { document.querySelector("h1").textContent = r.ok ? "Q3 plan" : "You don't have access"; });
</script>\`);
}).listen(port, "127.0.0.1");
`;
const CONFIG = `import { defineConfig } from "@playwright/test";
const port = process.env.JOURNEYS_PORT;
export default defineConfig({
  testDir: "e2e",
  reporter: [["list"], ["journeysfirst/reporter", { outputDir: "journey-runs" }]],
  use: { baseURL: \`http://127.0.0.1:\${port}\` },
  webServer: { command: "node app.mjs", url: \`http://127.0.0.1:\${port}\`, reuseExistingServer: false },
});
`;
const JOURNEY = `format: journeysfirst/v1
title: Open a doc
promise: I want the viewer to open the doc and read it.
users: [viewer]
start: The viewer has the doc's link.
steps:
  - The viewer opens the doc.
  - check: The viewer sees "Q3 plan".
    id: viewer-sees-it
`;
const SPEC = `import { test } from "journeysfirst/playwright";
test.journey("journeys/open-a-doc.journey.yaml", { video: false, measure: false }, async ({ journey }) => {
  const viewer = await journey.page("viewer", { account: "signed out" });
  await journey.step("The viewer opens the doc.", { by: "viewer" }, async () => {
    await viewer.goto("/doc/q3");
    await viewer.getByRole("heading", { name: /Q3 plan|access/ }).waitFor();
  });
  await journey.check("viewer-sees-it", { by: "viewer" }, async () => {
    const heading = await viewer.getByRole("heading").textContent();
    return { passed: heading === "Q3 plan", proof: "Read the heading.", reason: \`The viewer saw "\${heading}".\`, evidence: [{ source: "page", login: "viewer", url: "/doc/q3", saw: String(heading) }] };
  });
});
`;

test.journey("journeys/see-why-a-run-failed.journey.yaml", { video: true, pause: 0, measure: false }, async ({ journey }) => {
  test.setTimeout(180_000);
  const started = Date.now();
  /** @type {import("node:child_process").ChildProcess | null} */
  let review = null;
  try {
    const agent = await journey.page("agent");
    const you = await journey.page("you");
    // The broken build is installed from its packed tarball, so it has its own dependencies and really runs.
    const dir = broken ? install(packs().mainTgz) : linkProject(join(REPO, "packages/core"));
    mkdirSync(join(dir, "journeys"), { recursive: true });
    mkdirSync(join(dir, "e2e"), { recursive: true });
    writeFileSync(join(dir, "app.mjs"), APP);
    writeFileSync(join(dir, "playwright.config.js"), CONFIG);
    writeFileSync(join(dir, "journeys/open-a-doc.journey.yaml"), JOURNEY);
    writeFileSync(join(dir, "e2e/open-a-doc.spec.js"), SPEC);

    let played = { status: 1, output: "" };
    await journey.step("The agent runs the journey.", { by: "agent", caption: "The agent runs the journey." }, async () => {
      played = run(dir, process.execPath, [playwrightOf(dir), "test"], { JOURNEYS_PORT: freePort() });
      await show(agent, "The agent runs the journey", played.output);
    });

    const folder = newestRun(dir, "open-a-doc");
    const runJson = folder ? JSON.parse(readFileSync(join(folder, "run.json"), "utf8")) : null;
    const failedAt = runJson?.steps?.find((step) => step.verdict === "failed")?.id;

    await journey.check("run-fails-at-the-line", { by: "agent", caption: "Checking where the run failed." }, async () => {
      const passed = played.status !== 0 && failedAt === "viewer-sees-it";
      await show(agent, "Where the run failed", passed ? `The run failed at: ${runJson.steps[1].check}` : played.output);
      return { passed, proof: "Read the run's result for each line.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "agent", saw: failedAt ? `failed at ${failedAt}` : "no failed line" }], reason: "The run did not fail at the viewer's line.", caption: passed ? "the run failed at the viewer's line." : "the run did not fail there." };
    });

    const report = folder && existsSync(join(folder, "failure.md")) ? readFileSync(join(folder, "failure.md"), "utf8") : "";
    await journey.check("agent-sees-the-refusal", { by: "agent", caption: "Checking what the agent can read about it." }, async () => {
      const passed = /The viewer got a 403 from GET \/api\/doc\/q3 at line 1\./.test(report) && /- line 1: 403 GET \/api\/doc\/q3/.test(report);
      await show(agent, "What the app reported", report || "The run folder has no failure.md.");
      return { passed, proof: "Read failure.md in the run folder.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "agent", saw: passed ? "a 403 from GET /api/doc/q3 at line 1" : "no word of the 403" }], reason: "The run does not say what the app told the viewer.", caption: passed ? "the agent reads that the viewer got a 403." : "the run does not say what the app told the viewer." };
    });

    const port = freePort();
    await journey.step("You open the run.", { by: "you", caption: "You open the run." }, async () => {
      review = spawn(process.execPath, [binOf(dir), "review", "journey-runs", "--port", port], { cwd: dir, stdio: "pipe" });
      await new Promise((done, fail) => {
        review?.stdout?.on("data", (chunk) => String(chunk).includes("journeysfirst review:") && done(undefined));
        review?.on("exit", () => fail(new Error("The review page did not start.")));
      });
      await you.goto(`http://127.0.0.1:${port}/runs/open-a-doc/${basename(/** @type {string} */ (folder))}`);
    });

    await journey.check("you-see-what-the-app-said", { by: "you", caption: "Checking what you see under the failed line." }, async () => {
      const block = you.locator(".reported");
      const shown = (await block.count()) ? await block.first().innerText() : "";
      const passed = /What the app reported/.test(shown) && /The viewer got a 403 from GET \/api\/doc\/q3 at line 1\./.test(shown);
      if (passed) await block.first().scrollIntoViewIfNeeded();
      return { passed, proof: "Opened the run's page and read the block under the failed line.", evidence: [{ source: "page", url: you.url(), login: "you", saw: passed ? "What the app reported: the viewer got a 403" : "no report under the failed line" }], reason: "You do not see what the app told the viewer.", caption: passed ? "you see the 403 under the failed line." : "you do not see what the app said." };
    });
  } finally {
    /** @type {import("node:child_process").ChildProcess | null} */ (review)?.kill();
    markTime(`see-why-a-run-failed ${broken ? "fail" : "pass"}`, Date.now() - started);
  }
});
