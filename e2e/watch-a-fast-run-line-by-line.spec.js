import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "journeysfirst/playwright";
import { REPO, freePort, install, linkProject, markTime, newestRun, openReview, packs, playwrightOf, run, show } from "./support.js";

const broken = process.env.JF_BROKEN === "main";

const APP = `import { createServer } from "node:http";
createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Q3 plan</title><h1>Q3 plan</h1>")).listen(Number(process.env.JOURNEYS_PORT), "127.0.0.1");
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
title: Open a page
promise: You and the viewer can each open the page.
users: [viewer]
start: The page is up.
steps:
  - Open the page.
  - check: You see "Q3 plan".
    id: you-see-it
  - The viewer opens the page.
  - check: The viewer sees "Q3 plan".
    id: viewer-sees-it
`;
// No recording option: the run records the way a new project's run does.
const SPEC = `import { test } from "journeysfirst/playwright";
test.journey("journeys/open-a-page.journey.yaml", { measure: false }, async ({ journey }) => {
  const pages = { you: await journey.page("you"), viewer: await journey.page("viewer", { account: "signed out" }) };
  for (const [by, line, id] of [["you", "Open the page.", "you-see-it"], ["viewer", "The viewer opens the page.", "viewer-sees-it"]]) {
    await journey.step(line, { by }, async () => {
      await pages[by].goto("/");
      await pages[by].getByRole("heading").waitFor();
    });
    await journey.check(id, { by }, async () => {
      const heading = await pages[by].getByRole("heading").textContent();
      return { passed: heading === "Q3 plan", proof: "Read the heading.", reason: \`The heading was "\${heading}".\`, evidence: [{ source: "page", login: by, url: "/", saw: String(heading) }] };
    });
  }
});
`;

/** A check stays up about 2.5 s and an action about half a second. These leave room for a slow machine's clock. */
const LONG_ENOUGH = { check: 2, action: 0.4 };

test.journey("journeys/watch-a-fast-run-line-by-line.journey.yaml", { measure: false }, async ({ journey }) => {
  test.setTimeout(180_000);
  const started = Date.now();
  /** @type {Awaited<ReturnType<typeof openReview>> | null} */
  let review = null;
  try {
    const agent = await journey.page("agent");
    const you = await journey.page("you");
    // The broken build is the last release, where the run itself waits after each line.
    const dir = broken ? install(packs().mainTgz) : linkProject(join(REPO, "packages/core"));
    mkdirSync(join(dir, "journeys"), { recursive: true });
    mkdirSync(join(dir, "e2e"), { recursive: true });
    writeFileSync(join(dir, "app.mjs"), APP);
    writeFileSync(join(dir, "playwright.config.js"), CONFIG);
    writeFileSync(join(dir, "journeys/open-a-page.journey.yaml"), JOURNEY);
    writeFileSync(join(dir, "e2e/open-a-page.spec.js"), SPEC);

    let played = { status: 1, output: "" };
    await journey.step("The agent runs the journey.", { by: "agent", caption: "The agent runs the journey." }, async () => {
      played = run(dir, process.execPath, [playwrightOf(dir), "test"], { JOURNEYS_PORT: freePort() });
      await show(agent, "The agent runs the journey", played.output);
    });

    const folder = newestRun(dir, "open-a-page");
    /** @type {{steps: Array<{at: number, took?: number, check?: string}>, media?: Array<{file: string, kind: string, tags?: {user?: string}}>} | null} */
    const runJson = folder ? JSON.parse(readFileSync(join(folder, "run.json"), "utf8")) : null;
    const steps = runJson?.steps ?? [];

    await journey.check("video-for-every-user", { by: "agent", caption: "Checking that every user has a video." }, async () => {
      const videos = (runJson?.media ?? []).filter((m) => m.kind === "video" && statSync(join(/** @type {string} */ (folder), m.file), { throwIfNoEntry: false })?.size);
      const users = videos.map((m) => m.tags?.user);
      const passed = played.status === 0 && users.includes("you") && users.includes("viewer");
      await show(agent, "The videos the run kept", videos.map((m) => `${m.file}: ${m.tags?.user}`).join("\n") || played.output);
      return { passed, proof: "Read the run's videos and looked for each file.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "agent", saw: `videos for: ${users.join(", ") || "nobody"}` }], reason: "The run did not keep a video for every user.", caption: passed ? "you and the viewer each have a video." : "a user has no video." };
    });

    await journey.check("run-does-not-wait", { by: "agent", caption: "Checking that the run did not wait after its lines." }, async () => {
      // The time between the end of one line and the start of the next.
      const waited = Math.round(steps.slice(0, -1).reduce((sum, step, i) => sum + Math.max(0, steps[i + 1].at - step.at - (step.took ?? 0)), 0) * 10) / 10;
      const passed = steps.length === 4 && waited < 1.5;
      await show(agent, "How long the run waited", steps.map((step, i) => `line ${i + 1}: starts at ${step.at} s, takes ${step.took} s`).join("\n") + `\n\nBetween its lines the run waited ${waited} s in all.`);
      return { passed, proof: "Read when each line started and how long it took.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "agent", saw: `${waited} s between the lines in all` }], reason: `The run waited after its lines: ${waited} s in all.`, caption: passed ? "the run did not wait after its lines." : "the run waited after its lines." };
    });

    await journey.step("You open the run and play your video.", { by: "you", caption: "You open the run and play your video." }, async () => {
      review = await openReview(dir);
      await you.goto(`${review.url}/runs/open-a-page/${basename(/** @type {string} */ (folder))}`);
      await you.locator(".line").first().click();
    });

    await journey.check("each-line-stays-up", { by: "you", caption: "Checking that each line stays up long enough to read." }, async () => {
      // How long each line's words were up under your video in all, in the order they first came up, until the video ended.
      const shown = await you.evaluate(() => new Promise((done) => {
        const screen = document.querySelector(".screen:not([hidden])"), video = screen?.querySelector("video"), caption = screen?.querySelector(".caption");
        /** @type {Map<string, number>} */
        const lines = new Map();
        const began = performance.now();
        let before = began;
        const look = () => {
          const now = performance.now(), text = caption && !caption.hidden ? caption.textContent ?? "" : "";
          if (text) lines.set(text, (lines.get(text) ?? 0) + now - before);
          before = now;
          if (!video || !caption || video.ended || now - began > 30_000) return done([...lines.values()].map((ms) => Math.round(ms / 100) / 10));
          requestAnimationFrame(look);
        };
        look();
      }));
      const passed = shown.length === steps.length && steps.every((step, i) => shown[i] >= (step.check ? LONG_ENOUGH.check : LONG_ENOUGH.action));
      return { passed, proof: "Played your video from the first line and timed how long each line's words stayed under it.", evidence: [{ source: "page", url: you.url(), login: "you", saw: shown.length ? `the lines stayed up ${shown.map((s) => `${s} s`).join(", ")}` : "no line under the video" }], reason: "A line did not stay up long enough to read.", caption: passed ? "each line stays up long enough to read." : "a line goes by too fast to read." };
    });

    const lastLine = you.locator(".line").last();
    await journey.step("You pick the viewer's last line.", { by: "you", caption: "You pick the viewer's last line." }, async () => {
      await lastLine.click();
    });

    await journey.check("line-opens-its-video", { by: "you", caption: "Checking that you see the viewer's video at that line." }, async () => {
      const screen = you.locator(".screen:not([hidden])");
      const user = (await screen.count()) ? await screen.getAttribute("data-user") : null;
      const [time, at] = user ? [await screen.locator("video").evaluate((video) => /** @type {HTMLVideoElement} */ (video).currentTime), Number(await lastLine.getAttribute("data-at"))] : [0, 0];
      const passed = user === "viewer" && time >= at - 0.1;
      return { passed, proof: "Picked the viewer's last line and looked at whose video is up and where it is.", evidence: [{ source: "page", url: you.url(), login: "you", saw: `the video of ${user ?? "nobody"}, ${time.toFixed(2)} s in; the line starts ${at.toFixed(2)} s in` }], reason: "Picking the line did not open the viewer's video at that line.", caption: passed ? "the viewer's video is up, at that line." : "the viewer's video is not at that line." };
    });
  } finally {
    /** @type {Awaited<ReturnType<typeof openReview>> | null} */ (review)?.stop();
    markTime(`watch-a-fast-run-line-by-line ${broken ? "fail" : "pass"}`, Date.now() - started);
  }
});
