// Captions in a real Chromium, on pages with a strict Content-Security-Policy.
// The bar is checked in the recorded video itself: frames are read with
// ffmpeg. Needs Playwright's Chromium and ffmpeg on the PATH.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "@playwright/test";
import { JourneyRun } from "../src/runner/playwright.js";
import { JOURNEY } from "./helpers.js";

const POLICIES = {
  self: "default-src 'self'; style-src 'self'",
  nonce: "default-src 'self'; style-src 'nonce-n0nce'",
  "trusted-types": "default-src 'self'; style-src 'self'; require-trusted-types-for 'script'",
};
// Where the frames go when JF_FRAMES is set, so a person can look at them.
const FRAMES = process.env.JF_FRAMES;

let server;
let base;
/** Every path the pages asked the server for. */
const asked = [];
before(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    asked.push(path);
    const [, kind, name] = path.split("/");
    const policy = POLICIES[/** @type {keyof typeof POLICIES} */ (kind)];
    if (!policy || !name) return res.writeHead(404).end();
    const style = kind === "nonce" ? '<style nonce="n0nce">body{margin:0;background:#fff}</style>' : "";
    const fill = name === "a" ? "#ffe6d7" : "#d7e6ff";
    const marker = `<svg width="900" height="500"><rect width="900" height="500" fill="${fill}"/></svg>`;
    res.writeHead(200, { "content-type": "text/html", "content-security-policy": policy }).end(`<!doctype html><html><head>${style}</head><body><h1>Page ${name}</h1>${marker}</body></html>`);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((done) => server.close(done)));

/** The RGB of one pixel of an image or video file, read at 320x180. at: seconds into a video. */
function pixel(path, { at, x, y }) {
  const out = spawnSync("ffmpeg", ["-loglevel", "error", ...(at === undefined ? [] : ["-ss", String(at)]), "-i", path, "-frames:v", "1", "-vf", "scale=320:180", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
  assert.equal(out.status, 0, String(out.stderr));
  const i = (y * 320 + x) * 3;
  return [...out.stdout.subarray(i, i + 3)];
}
const dark = (rgb) => rgb.every((c) => c < 60);
const light = (rgb) => rgb.every((c) => c > 200);
const peach = (rgb) => light(rgb) && rgb[0] - rgb[2] > 20;
const blue = (rgb) => light(rgb) && rgb[2] - rgb[0] > 20;

/** The pixels at (160, 3) and (160, 120) in each frame scaled to 320x180. */
function captionFrames(video) {
  const height = 120 - 3 + 1;
  const out = spawnSync("ffmpeg", ["-loglevel", "error", "-i", video, "-vf", `scale=320:180,format=rgb24,crop=1:${height}:160:3`, "-f", "rawvideo", "pipe:1"]);
  assert.equal(out.status, 0, String(out.stderr));
  const frames = [];
  for (let i = 0; i < out.stdout.length; i += height * 3) {
    frames.push({ bar: [...out.stdout.subarray(i, i + 3)], page: [...out.stdout.subarray(i + (height - 1) * 3, i + height * 3)] });
  }
  return frames;
}

/** Record one user on a page with this policy: a step, then a check that moves to another page.
 * slowOpen: ms that opening a page takes after its video has started, like on a slow CI machine. */
async function record(kind, { slowOpen = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "jf-captions-"));
  const file = join(dir, "share-by-link.journey.yaml");
  writeFileSync(file, JOURNEY);
  const browser = await chromium.launch();
  if (slowOpen) {
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const context = await newContext(options);
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage();
        await new Promise((done) => setTimeout(done, slowOpen));
        return page;
      };
      return context;
    };
  }
  try {
    const testInfo = { project: { use: {} }, outputPath: (/** @type {string} */ p) => join(dir, p), attach: async () => {} };
    const run = new JourneyRun({ file, caseId: null, browser, testInfo, video: "paced", pause: 0 });
    const page = await run.page("you");
    const refused = [];
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text());
    });
    const requests = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.goto(`${base}/${kind}/a`);
    await run.step(1, { by: "you", caption: "You open the first page." }, () => page.waitForTimeout(1500));
    await run.check("link-on", { by: "you", caption: "Checking the second page." }, async () => {
      await page.goto(`${base}/${kind}/b`);
      await page.waitForTimeout(1500);
      // Distinguish the page during the check from the same page with the verdict caption.
      await page.locator("svg").evaluate((marker) => marker.remove());
      return { passed: true, proof: "Opened the second page.", evidence: [{ source: "page", login: "you", url: page.url(), saw: "Page b" }] };
    });
    const video = page.video();
    const finished = await run.finish();
    const { files } = run.recorder.result();
    return { run: finished, files, video: await video.path(), refused, requests };
  } finally {
    await browser.close();
  }
}

/** Seconds into the person's video of a step's start, plus wait. */
const into = (run, step, wait) => step.at - run.media.find((m) => m.kind === "video").starts_at + wait;

for (const kind of ["self", "nonce"]) {
  test(`under style-src ${kind === "self" ? "'self'" : "nonce only"}, the bar shows in the video, also after a navigation, with no CSP refusal and no request for it`, async () => {
    const { run, files, video, refused, requests } = await record(kind);
    const [step, check] = run.steps;
    // A fixed timestamp can land on a screenshot, when the bar is hidden.
    const frames = captionFrames(video);
    const firstPage = frames.findIndex(({ bar, page }) => dark(bar) && peach(page));
    const secondPage = frames.findIndex(({ bar, page }, i) => i > firstPage && dark(bar) && blue(page));
    for (const [label, frame] of [["first page", firstPage], ["after the navigation", secondPage]]) {
      assert.ok(frame >= 0, `${label}: the bar's dark fill is at the top and the page shows under it`);
      if (FRAMES) spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-i", video, "-vf", `select=eq(n\\,${frame})`, "-frames:v", "1", join(FRAMES, `${kind}-${label.replaceAll(" ", "-")}.png`)]);
    }
    assert.deepEqual(refused, []);
    assert.deepEqual([...new Set(requests)], [`/${kind}/a`, `/${kind}/b`], "the bar asks for nothing");
    // Screenshots are for the step, never the bar.
    const shot = join(mkdtempSync(join(tmpdir(), "jf-shot-")), "step-1.png");
    const first = step.screenshots[0];
    writeFileSync(shot, files.get(typeof first === "string" ? first : first.file));
    assert.ok(light(pixel(shot, { x: 160, y: 3 })));
    assert.equal(step.status, "done");
    assert.equal(check.verdict, "passed");
  });
}

test("when a page is slow to open, the video's steps still line up: the bar shows 1 second into step 1", async () => {
  const { run, video } = await record("self", { slowOpen: 1500 });
  const at = into(run, run.steps[0], 1.0);
  assert.ok(dark(pixel(video, { at, x: 160, y: 3 })), "the bar's dark fill is at the top");
});

test("on a page that requires Trusted Types, the run still passes; the page shows no bar", async () => {
  const { run, video } = await record("trusted-types");
  const [step, check] = run.steps;
  assert.equal(step.status, "done");
  assert.equal(check.verdict, "passed");
  assert.ok(light(pixel(video, { at: into(run, step, 1.0), x: 160, y: 3 })), "Playwright's overlay is refused, so there is no bar");
});
