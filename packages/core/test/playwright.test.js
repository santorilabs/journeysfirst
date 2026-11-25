// The Playwright fixture's users, sessions and checks, with a stand-in
// browser. The real browser run is in example.test.js.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_PAUSE, JourneyRun, NO_PROOF, THREW } from "../src/runner/playwright.js";
import { validateRun } from "../src/format/runfile.js";
import { CAPTION_CSS, adoptCaptionStyles } from "../src/runner/captions.js";
import { WATCH_BINDING, watchPage } from "../src/runner/measure.js";
import { JOURNEY, ON, VIEWER_SAW } from "./helpers.js";

// A page's screencast as Playwright 1.59+ has it. Each call goes into log, in order.
function fakeScreencast(log) {
  return {
    showOverlay: async (html) => {
      log.push(["show", html]);
      return { dispose: async () => log.push(["dispose", html]) };
    },
    showActions: async (options) => log.push(["showActions", options]),
    hideActions: async () => log.push(["hideActions"]),
    hideOverlays: async () => log.push(["hideOverlays"]),
    showOverlays: async () => log.push(["showOverlays"]),
  };
}

function fakeBrowser({ screencast = true } = {}) {
  const contexts = [];
  return {
    contexts,
    browserType: () => ({ name: () => "chromium" }),
    version: () => "131",
    newContext: async (options) => {
      const context = { options, granted: [], closed: false };
      context.grantPermissions = async (permissions) => context.granted.push(...permissions);
      context.initScripts = [];
      context.addInitScript = async (script, arg) => context.initScripts.push([script, arg]);
      context.exposeBinding = async (name, fn) => (context.report = (event) => fn({}, event));
      context.route = async (pattern, handler) => (context.routed = [pattern, handler]);
      context.listeners = {};
      context.on = (event, fn) => (context.listeners[event] ??= []).push(fn);
      context.emit = (event, value) => (context.listeners[event] ?? []).forEach((fn) => fn(value));
      context.sizes = [];
      context.log = [];
      context.newPage = async () => ({
        ...(screencast ? { screencast: fakeScreencast(context.log) } : {}),
        context: () => context,
        goto: async (url) => (context.visited = url),
        url: () => (context.visited ? new URL(context.visited, "http://localhost:4321").href : "about:blank"),
        video: () => null,
        isClosed: () => context.closed,
        locator: () => ({ ariaSnapshot: async () => context.outline ?? "- main" }),
        evaluate: async () => ({ width: context.sizes.at(-1)?.width ?? 1280, controls: [{ name: 'button "Share"', height: 40 }], said: context.onScreen }),
        viewportSize: () => ({ width: 1280, height: 800 }),
        setViewportSize: async (size) => context.sizes.push(size),
        screenshot: async () => {
          context.log.push(["screenshot"]);
          return Buffer.from("png");
        },
      });
      context.close = async () => (context.closed = true);
      contexts.push(context);
      return context;
    },
  };
}

function journeyRun({ screencast, ...options } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "jf-pw-"));
  const file = join(dir, "share-by-link.journey.yaml");
  writeFileSync(file, JOURNEY.replace("send the link to the viewer.", "send ${link} to the viewer."));
  const browser = fakeBrowser({ screencast });
  const attached = [];
  const testInfo = { project: { use: { baseURL: "http://localhost:4321" } }, outputPath: (p) => join(dir, p), attach: async (name) => attached.push(name) };
  return { browser, attached, testInfo, run: new JourneyRun({ file, caseId: null, browser, testInfo, video: true, pause: 0, ...options }) };
}

test("each user gets their own context, with clipboard access and video", async () => {
  const { browser, run } = journeyRun();
  const you = await run.page("you");
  const viewer = await run.page("viewer");
  assert.notEqual(you.context(), viewer.context());
  assert.equal(await run.page("you"), you);
  assert.equal(browser.contexts.length, 2);
  for (const context of browser.contexts) {
    assert.deepEqual(context.granted, ["clipboard-read", "clipboard-write"]);
    assert.match(context.options.recordVideo.dir, /video-(you|viewer)$/);
  }
  await assert.rejects(run.page("admin"), /"admin" is not a user in this journey/);
});

test("the test's use options are left to Playwright, not copied from the project", async () => {
  const { browser, run } = journeyRun();
  await run.page("you");
  assert.deepEqual(Object.keys(browser.contexts[0].options), ["recordVideo"]);
});

test("a login hook signs a user in once, in their own context; without one they are signed out", async () => {
  const { browser, run } = journeyRun();
  let calls = 0;
  const login = async (context, page) => {
    calls += 1;
    await page.goto("/signin/owner");
  };
  await run.page("you", { account: "owner@example.test", login });
  await run.page("you");
  await run.page("viewer", { account: "signed out" });
  assert.equal(calls, 1);
  assert.equal(browser.contexts[0].visited, "/signin/owner");
  assert.equal(browser.contexts[1].visited, undefined);
  assert.equal(browser.contexts[1].options.storageState, undefined);
  assert.deepEqual(run.recorder.users, { you: "owner@example.test", viewer: "signed out" });
});

test("login or storageState for a user who already has a page is an error", async () => {
  const { run } = journeyRun();
  await run.page("you");
  await assert.rejects(run.page("you", { login: async () => {} }), /The page for you is already open\. Pass login or storageState the first time/);
  await run.page("viewer");
  await assert.rejects(run.page("viewer", { storageState: "auth/viewer.json" }), /The viewer's page is already open/);
});

test("a failed login closes its context and leaves no page behind, so a retry starts fresh", async () => {
  const { browser, run } = journeyRun();
  await assert.rejects(run.page("you", { login: async () => { throw new Error("sign-in link expired"); } }), /sign-in link expired/);
  assert.equal(browser.contexts[0].closed, true);
  await run.page("you", { login: async (context, page) => page.goto("/signin/owner") });
  assert.equal(browser.contexts.length, 2);
  assert.equal(browser.contexts[1].visited, "/signin/owner");
});

test("a saved login starts the user's context", async () => {
  const { browser, run } = journeyRun();
  await run.page("viewer", { storageState: "auth/viewer.json" });
  assert.equal(browser.contexts[0].options.storageState, "auth/viewer.json");
});

test("a check that throws is blocked with cause test and a proof, and the run is still valid", async () => {
  const { run } = journeyRun();
  await run.page("you");
  await run.check("link-on", { by: "you" }, async () => {
    throw new Error("locator.click: Timeout 5000ms exceeded.\nCall log: ...");
  });
  const step = run.recorder.result().run.steps[1];
  assert.equal(step.verdict, "blocked");
  assert.equal(step.cause, "test");
  assert.equal(step.proof, THREW);
  assert.equal(step.reason, "locator.click: Timeout 5000ms exceeded.");
  assert.deepEqual(validateRun(run.recorder.result().run), []);
});

test("a check that returns nothing is blocked with cause test", async () => {
  const { run } = journeyRun();
  await run.check("link-on", { by: "you" }, async () => {});
  const step = run.recorder.result().run.steps[1];
  assert.deepEqual([step.verdict, step.cause, step.reason], ["blocked", "test", "The check returned nothing."]);
});

test("a failed check with no proof or reason still writes a valid run", async () => {
  const { run } = journeyRun();
  await run.check("link-on", { by: "you" }, async () => ({ passed: false }));
  const file = run.recorder.result().run;
  assert.deepEqual([file.steps[1].verdict, file.steps[1].cause, file.steps[1].reason], ["failed", "product", "It was not true when checked."]);
  assert.equal(file.steps[1].proof, NO_PROOF);
  assert.equal(file.result, "failed");
  assert.deepEqual(validateRun(file), []);
});

test("each step and check says who did it, and the screenshot is of that user's page", async () => {
  const { run } = journeyRun();
  await run.page("viewer");
  await assert.rejects(run.step(1, {}, async () => {}), /Say who did this line, with by: one of you, viewer\./);
  await assert.rejects(run.check("link-on", { by: "admin" }, async () => ({ passed: true })), /"admin" is not a user in this journey/);
  await run.step(1, { by: "viewer" }, async () => {});
  const step = run.recorder.result().run.steps[0];
  assert.deepEqual([step.by, step.screenshots], ["viewer", ["step-1.png"]]);
});

test("a screenshot records the address of the page it was taken on, without its query or fragment", async () => {
  const { run } = journeyRun();
  const you = await run.page("you");
  await run.step(1, { by: "you" }, async () => you.goto("/p/q3-plan?tab=share"));
  await run.step(3, { by: "you" }, async () => you.goto("/auth/callback?code=oauth-code-1#access_token=tok-1"));
  const [first, , third] = run.recorder.result().run.steps;
  assert.deepEqual(first.screenshots, [{ file: "step-1.png", url: "http://localhost:4321/p/q3-plan" }]);
  assert.deepEqual(third.screenshots, [{ file: "step-3.png", url: "http://localhost:4321/auth/callback" }]);
  assert.doesNotMatch(JSON.stringify(run.recorder.result().run), /oauth-code-1|tok-1|tab=share/);
  assert.deepEqual(validateRun(run.recorder.result().run), []);
});

test("relative evidence urls are written in full, against that login's page or the baseURL", async () => {
  const { run } = journeyRun();
  const viewer = await run.page("viewer");
  await viewer.goto("http://preview-12.example.test/view/q3-plan");
  await run.check("link-on", { by: "you" }, async () => ({
    passed: true,
    proof: "Read the saved setting.",
    evidence: [
      { source: "api", login: "you", url: "/api/share" },
      { source: "page", login: "viewer", url: "/view/q3-plan" },
      { source: "page", login: "viewer", url: "https://other.example.test/x" },
      { source: "database", login: "you", query: "select 1" },
    ],
  }));
  const evidence = run.recorder.result().run.steps[1].evidence;
  assert.deepEqual(evidence.map((e) => e.url), ["http://localhost:4321/api/share", "http://preview-12.example.test/view/q3-plan", "https://other.example.test/x", undefined]);
});

test("an evidence url filled in from a page drops the page's query and fragment; a url the author typed is kept", async () => {
  const { run } = journeyRun();
  const viewer = await run.page("viewer");
  await viewer.goto("http://preview-12.example.test/signin?token=one-time-1#access_token=tok-1");
  await run.check("viewer-sees-it", { by: "viewer" }, async () => ({
    passed: true,
    proof: "Opened the page.",
    evidence: [
      { source: "page", login: "viewer", url: "" },
      { source: "page", login: "viewer", url: "/view/q3-plan?tab=1" },
      { source: "page", login: "viewer", url: "https://other.example.test/x?typed=yes" },
    ],
  }));
  const evidence = run.recorder.result().run.steps[3].evidence;
  assert.deepEqual(evidence.map((e) => e.url), ["http://preview-12.example.test/signin", "http://preview-12.example.test/view/q3-plan?tab=1", "https://other.example.test/x?typed=yes"]);
});

test("a run cut short marks the line in progress blocked, and finishing twice attaches once", async () => {
  const { run, attached } = journeyRun();
  await run.page("you");
  const hung = run.step(1, { by: "you" }, () => new Promise(() => {}));
  const [first, second] = await Promise.all([run.finish(), run.finish()]);
  assert.equal(first, second);
  assert.equal(first.steps[0].status, "blocked");
  assert.equal(first.steps[0].reason, "The test stopped during this line: it timed out or was cancelled.");
  assert.deepEqual(validateRun(first), []);
  assert.equal(attached.filter((name) => name === "journeysfirst-run").length, 1);
  void hung;
});

test("values captured from the app go into the run's values; repos come from the caller", async () => {
  const preview = [{ repo: "acme/web", commit: "f00d", branch: "preview-12" }];
  const { run } = journeyRun({ repos: preview });
  run.value("link", "http://localhost:4321/view/q3-plan");
  run.value("code", "123456", { secret: true });
  const file = await run.finish();
  assert.deepEqual(file.values, { link: { value: "http://localhost:4321/view/q3-plan" }, code: { secret: true } });
  assert.doesNotMatch(JSON.stringify(file), /123456/);
  assert.deepEqual(file.repos, preview);
  assert.equal(file.tags.browser, "chromium 131");
  assert.equal(file.ran_by.agent, process.env.JOURNEYSFIRST_AGENT ?? "playwright");
});

/** The text of each caption bar shown on a context's page, in order. */
const captions = (context) => context.log.filter(([call]) => call === "show").map(([, html]) => html.replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim());
const dimmed = (html) => html.includes(" jf-away\"");

/** The measure files a finished run attached, parsed, by name. */
async function measureFiles(run) {
  await run.finish();
  const { files } = run.recorder.result();
  return Object.fromEntries([...files].filter(([name]) => name.startsWith("measure-")).map(([name, body]) => [name, JSON.parse(body.toString())]));
}

test("after each line the user's screen is measured at the run's width and at 375 px, with that line's actions, and saved without the page's query", async () => {
  const { browser, run } = journeyRun();
  const you = await run.page("you");
  await you.goto("/p/q3-plan?token=abc#frag");
  const [context] = browser.contexts;
  context.report({ kind: "action", at: 500, name: "Sign in" });
  await run.step(1, { by: "you" }, async () => {
    context.report({ kind: "action", at: 1000, name: "Share" });
    context.report({ kind: "change", at: 1012, text: "open on dialog" });
    context.report({ kind: "action", at: 2000, name: "Copy link" });
  });
  context.report({ kind: "change", at: 2500, text: "style on input" });
  await run.check("link-on", { by: "you" }, async () => ({ passed: true, proof: "Read it.", evidence: [{ source: "page", login: "you", url: "/p/q3-plan" }] }));
  const files = await measureFiles(run);
  assert.deepEqual(Object.keys(files), ["measure-1.txt", "measure-2.txt"]);
  assert.equal(files["measure-1.txt"].url, "http://localhost:4321/p/q3-plan", "no query or fragment: the file is published");
  assert.equal(files["measure-1.txt"].wide.width, 1280);
  assert.equal(files["measure-1.txt"].phone.width, 375);
  assert.deepEqual(context.sizes, [{ width: 375, height: 800 }, { width: 1280, height: 800 }, { width: 375, height: 800 }, { width: 1280, height: 800 }], "the page goes back to its own size");
  assert.deepEqual(files["measure-1.txt"].actions, [{ name: "Share", ms: 12, changed: "open on dialog" }, { name: "Copy link", ms: null }], "setup before the line is left out, and a click that changed nothing has no time");
  assert.deepEqual(files["measure-2.txt"].actions, [], "a change after the line ended is not credited to it");
  const media = run.recorder.result().run.media.filter((m) => m.file.startsWith("measure-"));
  assert.deepEqual(media, [{ file: "measure-1.txt", kind: "capture", tags: { user: "you" } }, { file: "measure-2.txt", kind: "capture", tags: { user: "you" } }]);
});

test("the time a line took does not include measuring it", async () => {
  const { browser, run } = journeyRun();
  const you = await run.page("you");
  const evaluate = you.evaluate;
  you.evaluate = async () => {
    await new Promise((done) => setTimeout(done, 250));
    return evaluate();
  };
  await run.step(1, { by: "you" }, async () => {});
  assert.ok(run.recorder.result().run.steps[0].took < 0.2, "took is the line, not the measuring");
  assert.equal(browser.contexts[0].sizes.length, 2);
});

test("a secret on screen is written to a measure file as its name, never its value", async () => {
  const { browser, run } = journeyRun();
  await run.page("you");
  browser.contexts[0].onScreen = 'Your code is 481-516 "now"';
  await run.step(1, { by: "you" }, async () => run.value("code", '481-516 "now"', { secret: true }));
  const files = await measureFiles(run);
  assert.equal(files["measure-1.txt"].wide.said, "Your code is ${code}");
});

test('measure: "wide" never resizes the page, and measure: false saves nothing', async () => {
  const wide = journeyRun({ measure: "wide" });
  await wide.run.page("you");
  await wide.run.step(1, { by: "you" }, async () => {});
  assert.deepEqual(Object.keys((await measureFiles(wide.run))["measure-1.txt"]), ["wide", "actions"]);
  assert.deepEqual(wide.browser.contexts[0].sizes, []);
  const off = journeyRun({ measure: false });
  await off.run.page("you");
  await off.run.step(1, { by: "you" }, async () => {});
  assert.deepEqual(await measureFiles(off.run), {});
  assert.equal(off.browser.contexts[0].report, undefined, "nothing watches the page");
});

test("a slow replay holds each data request, prints each action's time and writes no run", async (t) => {
  const { browser, attached, run } = journeyRun({ delay: 2000 });
  await run.page("you");
  const [context] = browser.contexts;
  const [pattern, handler] = context.routed;
  assert.equal(pattern, "**/*");
  const held = [];
  const route = (type) => ({ request: () => ({ resourceType: () => type }), fallback: async () => held.push(type) });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await handler(route("script"));
  const data = handler(route("fetch"));
  assert.deepEqual(held, ["script"], "only data requests wait");
  t.mock.timers.tick(2000);
  await data;
  assert.deepEqual(held, ["script", "fetch"]);
  t.mock.timers.reset();
  await run.step(1, { by: "you" }, async () => {
    context.report({ kind: "action", at: 1000, name: "Share" });
    context.report({ kind: "change", at: 3017, text: "open on dialog" });
  });
  const printed = t.mock.method(console, "log", () => {});
  await run.finish();
  assert.equal(printed.mock.calls[0].arguments[0], 'journeysfirst: slow replay, each data request delayed 2000 ms. No run was written.\nline 1 (you): "Share" 2017 ms');
  assert.deepEqual(attached, [], "no run and no file is attached, so the reporter writes nothing");
  assert.deepEqual(context.sizes, [], "a slow replay does not measure the screen");
});

test("with video on, every user's page shows the line in progress, dimmed on the pages of users it isn't about", async () => {
  const { browser, run } = journeyRun();
  await run.page("you");
  await run.page("viewer");
  await run.step(1, { by: "you", caption: "You turn on link sharing and copy the link." }, async () => {});
  const [you, viewer] = browser.contexts;
  assert.deepEqual(captions(you), ["You turn on link sharing and copy the link."]);
  assert.deepEqual(captions(viewer), ["You turn on link sharing and copy the link."]);
  assert.deepEqual([dimmed(you.log.find(([c]) => c === "show")[1]), dimmed(viewer.log.find(([c]) => c === "show")[1])], [false, true]);
  assert.deepEqual(you.log[0], ["showActions", { position: "bottom-right" }], "clicks are marked away from the bar at the top");
  assert.match(you.log.find(([c]) => c === "show")[1], /part="jf-bar jf-top /);
  await run.step(3, { by: "viewer" }, async () => {});
  assert.equal(captions(you)[1], "Viewer: The viewer opens the link.");
  assert.ok(you.log.some(([call, html]) => call === "dispose" && html.includes("copy the link")), "the old caption comes down");
});

test("without a caption, a step shows who and its line, with known values filled in", async () => {
  const { browser, run } = journeyRun();
  await run.page("you");
  run.value("link", "q3.example.test");
  await run.step(1, { by: "you" }, async () => {});
  run.value("link", "https://secret.example.test/x", { secret: true });
  await run.step(1, { by: "you" }, async () => {});
  assert.deepEqual(captions(browser.contexts[0]), ["You: Turn on link sharing and send q3.example.test to the viewer.", "You: Turn on link sharing and send ${link} to the viewer."]);
});

test("a check shows what is being checked, then its verdict first and why, in one sentence", async () => {
  const evidence = [{ source: "page", login: "you", url: "/p", saw: "it" }];
  for (const [options, result, shown] of [
    [{ caption: "Checking that link sharing stays on after a reload." }, { passed: true, proof: "Reloaded the page.", evidence, caption: "the box is still checked after a reload." }, "Passed: the box is still checked after a reload."],
    [{}, { passed: false, reason: "The box was unchecked after a reload. It saved nothing." }, "Failed: the box was unchecked after a reload."],
    [{}, { passed: false, reason: "Q3 plan was missing." }, "Failed: Q3 plan was missing."],
    [{}, { passed: true, proof: "Read the saved setting.", evidence }, "Passed: read the saved setting."],
    [{}, { passed: true, caption: "the box is still checked." }, "Not checked: no evidence was attached."],
    [{}, { verdict: "blocked", cause: "environment", reason: "The app did not start." }, "Blocked: the app did not start."],
  ]) {
    const { browser, run } = journeyRun();
    await run.page("you");
    await run.check("link-on", { by: "you", ...options }, async () => result);
    const [checking, verdict] = captions(browser.contexts[0]);
    assert.equal(checking, options.caption ?? "Checking: Link sharing is still on after a reload.");
    assert.equal(verdict, shown);
  }
});

test("a user whose page opens mid-run sees the caption now on screen", async () => {
  const { browser, run } = journeyRun();
  await run.page("you");
  await run.step(1, { by: "you" }, async () => {});
  await run.page("viewer");
  assert.match(captions(browser.contexts[1])[0], /^You: Turn on link sharing/);
});

test("screenshots leave out the caption bar and the click marks, then put them back", async () => {
  const { browser, run } = journeyRun();
  await run.page("you");
  await run.step(1, { by: "you" }, async () => {});
  const calls = browser.contexts[0].log.map(([call]) => call);
  const shot = calls.indexOf("screenshot");
  assert.deepEqual(calls.slice(shot - 2, shot + 3), ["hideOverlays", "hideActions", "screenshot", "showOverlays", "showActions"]);
});

test("with captions on, each user's context adopts the caption stylesheet on every document; with them off it adds nothing", async () => {
  const on = journeyRun();
  await on.run.page("you");
  await on.run.page("viewer");
  // The other init script watches the page for the review's action times (measure.js).
  const captionScripts = (context) => context.initScripts.filter(([script]) => script !== watchPage);
  for (const context of on.browser.contexts) assert.deepEqual(captionScripts(context), [[adoptCaptionStyles, CAPTION_CSS]]);
  for (const context of on.browser.contexts) assert.deepEqual(context.initScripts.filter(([script]) => script === watchPage), [[watchPage, WATCH_BINDING]]);
  for (const options of [{ captions: false }, { video: false }]) {
    const off = journeyRun(options);
    await off.run.page("you");
    assert.deepEqual(captionScripts(off.browser.contexts[0]), [], JSON.stringify(options));
  }
});

test("captions: false, video off, or a Playwright without page.screencast shows no captions", async () => {
  for (const options of [{ captions: false }, { video: false }, { screencast: false }]) {
    const { browser, run } = journeyRun(options);
    await run.page("you");
    await run.step(1, { by: "you" }, async () => {});
    await run.check("link-on", { by: "you" }, async () => ({ passed: false }));
    assert.deepEqual(browser.contexts[0].log.filter(([call]) => call !== "screenshot"), [], JSON.stringify(options));
    assert.equal(run.recorder.result().run.steps[0].screenshots.length, 1);
  }
});

test("with video on, the run pauses after each action, five times as long after a check", async () => {
  assert.equal(journeyRun({ pause: undefined }).run.pause, DEFAULT_PAUSE);
  assert.equal(journeyRun({ pause: undefined, video: false }).run.pause, 0);
  const { run } = journeyRun({ pause: 40 });
  await run.page("you");
  // Node timers run on a clock rounded to whole ms, so a 40 ms wait can measure 39 ms. Allow that 1 ms.
  let start = performance.now();
  await run.step(1, { by: "you" }, async () => {});
  assert.ok(performance.now() - start >= 39);
  start = performance.now();
  await run.check("link-on", { by: "you" }, async () => ({ passed: false }));
  assert.ok(performance.now() - start >= 199);
});

test("each line's start and length, and each user's page start, are in the run, so a step can be found in a video", async () => {
  const { run } = journeyRun();
  await run.page("you");
  await run.step(1, { by: "you" }, async () => new Promise((done) => setTimeout(done, 120)));
  const step = run.recorder.result().run.steps[0];
  assert.ok(step.at >= run.pages.get("you").startsAt && step.took >= 0.1, JSON.stringify(step));
});

test("captions: { position: \"bottom\" } puts the bar at the bottom and the click marks at the top", async () => {
  const { browser, run } = journeyRun({ captions: { position: "bottom" } });
  await run.page("you");
  await run.step(1, { by: "you" }, async () => {});
  const log = browser.contexts[0].log;
  assert.deepEqual(log[0], ["showActions", { position: "top-right" }]);
  assert.match(log.find(([c]) => c === "show")[1], /part="jf-bar jf-bottom /);
  assert.deepEqual(log.filter(([c]) => c === "showActions").map(([, o]) => o.position), ["top-right", "top-right"], "after a screenshot the marks go back to the same corner");
  assert.throws(() => journeyRun({ captions: { position: "left" } }), /captions position must be "top" or "bottom", not "left"\./);
});

test("a screenshot covers the page, then puts it back", async () => {
  const { run } = journeyRun({ measure: false });
  const you = await run.page("you");
  const names = [];
  you.evaluate = async (fn) => {
    names.push(fn.name);
    return fn.name === "applyMask" ? true : undefined;
  };
  await run.step(1, { by: "you" }, async () => {});
  assert.deepEqual(names, ["applyMask", "restoreMask"]);
});

test("a screenshot does not restore the page when nothing was covered", async () => {
  const { run } = journeyRun({ measure: false });
  const you = await run.page("you");
  const names = [];
  you.evaluate = async (fn) => {
    names.push(fn.name);
    return false;
  };
  await run.step(1, { by: "you" }, async () => {});
  assert.deepEqual(names, ["applyMask"]);
});

test("finish gives the reporter the secret values, and the run file does not contain them", async () => {
  const { run, testInfo } = journeyRun({ measure: false, video: false });
  /** @type {Map<string, Buffer>} */
  const bodies = new Map();
  testInfo.attach = async (name, options) => bodies.set(name, options?.body);
  await run.page("you");
  run.recorder.value("code", "481516-secret", { secret: true });
  await run.step(1, { by: "you" }, async () => {});
  await run.finish();
  assert.deepEqual(JSON.parse(bodies.get("journeysfirst-secrets").toString()), ["481516-secret"]);
  assert.doesNotMatch(bodies.get("journeysfirst-run").toString(), /481516-secret/);
});

test("a failed check writes what the app reported since the last check, for every user, and a passing run writes none", async () => {
  const { browser, run } = journeyRun();
  await run.page("you");
  await run.step(1, { by: "you" }, async () => {
    browser.contexts[0].emit("response", fakeResponse(500, "POST", "http://localhost:4321/api/share?x=1"));
  });
  await run.check("link-on", { by: "you" }, async () => ({ passed: true, proof: "Read the setting.", evidence: [ON] }));
  // Reported after the check, before the next line: still part of the passed check, so dropped.
  browser.contexts[0].emit("response", fakeResponse(502, "GET", "http://localhost:4321/api/after-check"));
  await run.page("viewer");
  await run.step(3, { by: "viewer" }, async () => {
    browser.contexts[1].emit("response", fakeResponse(403, "GET", "http://localhost:4321/api/view/q3-plan"));
    browser.contexts[1].emit("console", { type: () => "error", text: () => "Failed to load resource: 403" });
    browser.contexts[1].emit("console", { type: () => "log", text: () => "not an error" });
  });
  browser.contexts[1].outline = "- heading \"You don't have access\" [level=1]";
  await run.check("viewer-sees-it", { by: "viewer" }, async () => ({ passed: false, proof: "Read the heading.", evidence: [VIEWER_SAW] }));
  await run.finish();
  const { files, run: written } = run.recorder.result();
  const report = JSON.parse(String(files.get("failure.json")));
  assert.equal(report.line, 4);
  assert.equal(report.since, 3, "the passed check at line 2 starts the window over");
  assert.equal(report.summary, "The viewer got a 403 from GET /api/view/q3-plan at line 3.");
  assert.deepEqual(report.users.map((u) => u.user), ["viewer", "you"]);
  assert.deepEqual(report.users[0].requests, [{ line: 3, method: "GET", path: "/api/view/q3-plan", status: 403 }]);
  assert.deepEqual(report.users[0].errors, [{ line: 3, text: "Failed to load resource: 403" }]);
  assert.deepEqual(report.users[1].requests, [], "your 500 at line 1 and the 502 right after the check came before the window");
  assert.equal(report.users[0].outline, "- heading \"You don't have access\" [level=1]");
  assert.match(String(files.get("failure.md")), /^# What the app reported at line 4\n/);
  assert.deepEqual(written.media.filter((m) => m.kind === "capture").map((m) => m.file), ["measure-1.txt", "measure-2.txt", "measure-3.txt", "measure-4.txt", "failure.json", "failure.md"]);

  const passing = journeyRun();
  await passing.run.page("you");
  await passing.run.step(1, { by: "you" }, async () => {
    passing.browser.contexts[0].emit("response", fakeResponse(404, "GET", "http://localhost:4321/favicon.ico"));
  });
  await passing.run.check("link-on", { by: "you" }, async () => ({ passed: true, proof: "Read the setting.", evidence: [ON] }));
  await passing.run.finish();
  assert.equal(passing.run.recorder.result().files.has("failure.md"), false);
});

/** @param {number} status @param {string} method @param {string} url */
function fakeResponse(status, method, url) {
  return { status: () => status, request: () => ({ method: () => method, url: () => url, frame: () => ({ url: () => "http://localhost:4321/" }) }) };
}
