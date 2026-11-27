// Playwright fixture: a normal Playwright test that walks a journey's lines.
// Each user gets their own browser context (their own login), with video.
// It records through RunRecorder, so a Playwright run and an agent's own run
// write the same run file. The reporter writes it to disk.
import { test as base } from "@playwright/test";
import { CAPTION_CSS, actionsFor, adoptCaptionStyles, canCaption, captionHtml, captionSettings, cleanScreenshot, fillValues, replaceCaption, shortCaption, userLabel } from "./captions.js";
import { loadJourney } from "../format/format.js";
import { delayData, measureScreen, slowReport, watchActions } from "./measure.js";
import { MASK, applyMask, restoreMask } from "./mask.js";
import { atCaller } from "./caller.js";
import { RunRecorder } from "./recorder.js";
import { captureUsers, failureMarkdown, failureReport, watchApp } from "./reported.js";
import { isFullUrl, settleCheck } from "../format/runfile.js";
import { CHECK_PAUSES, DEFAULT_PAUSE } from "../shared/display.js";
import { missingTarget } from "../shared/target.js";

export { expect } from "@playwright/test";

export const RUN_ATTACHMENT = "journeysfirst-run";
export const FILE_ATTACHMENT = "journeysfirst-file:";
/** Declared secret values for the reporter, so it can redact a trace. Not a run file. */
export const SECRET_ATTACHMENT = "journeysfirst-secrets";
export const THREW = "The check threw an error before it could prove anything.";
export const NO_PROOF = "The runner did not say how it was proven.";
export { DEFAULT_PAUSE };

/**
 * @typedef {{passed?: boolean, verdict?: "passed"|"failed"|"blocked"|"not_checked", proof?: string,
 *   evidence?: import("../format/runfile.js").Evidence[], cause?: "product"|"test"|"environment", reason?: string,
 *   caption?: string}} CheckResult caption: one plain sentence for a paced video after the verdict word,
 *   like "the new project is not in Your projects." It shows as "Failed: the new project is not in Your projects."
 * @typedef {import("@playwright/test").BrowserContextOptions} BrowserContextOptions
 * @typedef {{context: import("@playwright/test").BrowserContext, page: import("@playwright/test").Page, startsAt: number,
 *   captioned: boolean, caption: {dispose: () => Promise<void>} | null, actions: import("./measure.js").Watch | null,
 *   app: import("./reported.js").AppWatch}} UserPage
 * @typedef {boolean | "paced"} VideoOption true: record each user's screen with no waiting; the review page holds on each line.
 *   "paced": the run waits after each line and draws the caption bar and click marks into the video, for a clip shared as a raw file.
 * @typedef {boolean | "wide"} MeasureOption true: measure each user's screen after every line, at the run's width and at 375 px.
 *   "wide": never resize the page. false: do not measure.
 */

export class JourneyRun {
  /**
   * @param {{file: string, caseId: string|null, browser: import("@playwright/test").Browser, testInfo: import("@playwright/test").TestInfo,
   *   video: VideoOption, captions?: import("./captions.js").CaptionsOption, pause?: number, measure?: MeasureOption, delay?: number,
   *   repos?: Array<{repo: string, commit?: string, branch?: string}>, tags?: Record<string, unknown>}} options
   *   captions: show the line in progress on each user's paced video (default on, at the top).
   *   false turns them off; {position: "bottom"} moves the bar.
   *   pause: ms to wait after each action, and five times that after a check so its verdict can be read (default 500 for a paced video, else 0).
   *   measure: save measure-<line>.txt after each line, for a review (default on).
   *   delay: ms to hold each data request, for a slow replay. A slow replay prints each action's time and writes no run.
   */
  constructor({ file, caseId, browser, testInfo, video, captions, pause, measure = true, delay = 0, repos, tags }) {
    this.recorder = RunRecorder.start({
      journey: file,
      case: caseId,
      ranBy: { agent: process.env.JOURNEYSFIRST_AGENT ?? "playwright" },
      tags: { browser: `${browser.browserType().name()} ${browser.version()}`, ...tags },
      repos,
    });
    this.browser = browser;
    this.testInfo = testInfo;
    this.video = Boolean(video);
    /** A paced video carries its own captions and pauses. For any other, the review page shows the lines and holds on each. */
    this.paced = video === "paced";
    /** Where the caption bar goes, or null for no captions. */
    this.captions = this.paced ? captionSettings(captions, undefined) : null;
    this.pause = pause ?? (this.paced ? DEFAULT_PAUSE : 0);
    this.measure = measure;
    this.delay = delay;
    /** What was measured after each line. Written when the run finishes, so a secret set later is still kept out. */
    /** @type {Array<{line: number, user: string, url?: string, actions: import("./measure.js").ActionTime[], wide?: object, phone?: object}>} */
    this.measured = [];
    /** @type {Map<string, UserPage>} */
    this.pages = new Map();
    /** The caption on every page now. A page opened later shows it too. @type {import("./captions.js").Caption | null} */
    this.caption = null;
    /** The line in progress, so a run cut short by a timeout still says where it stopped. */
    /** @type {{line: number|string, n: number, says: string, by: string} | null} */
    this.current = null;
    /** The last line started, and the first line after the last check. A failure report covers from there. */
    this.lastLine = /** @type {number|null} */ (null);
    this.sinceLine = 1;
    /** What the app reported at the first failed line, written when the run finishes. @type {import("./reported.js").Captured | null} */
    this.failure = null;
    /** @type {Promise<import("../format/runfile.js").Run> | null} */
    this.finished = null;
  }

  /**
   * A user's page, in their own browser context, so each user acts in
   * their own session. Made on first use. With no login and no storageState
   * the user is signed out. The test's `use` options (baseURL, viewport and
   * the rest) apply, as for Playwright's own page.
   * @param {string} [user] "you" or a name from the journey's users
   * @param {{
   *   account?: string|null,
   *   login?: (context: import("@playwright/test").BrowserContext, page: import("@playwright/test").Page) => Promise<unknown>,
   *   storageState?: BrowserContextOptions["storageState"],
   * }} [options]
   *   account: the account this user uses, for the run's users map.
   *   login: signs the user in once, in their own context (a one-time sign-in link, an init script, a cookie).
   *   storageState: a saved Playwright login to start from.
   */
  async page(user = "you", { account, login, storageState } = {}) {
    this.recorder.knows(user);
    if (account !== undefined) this.recorder.user(user, account);
    const existing = this.pages.get(user);
    if (existing) {
      if (login || storageState) throw new Error(`The ${user === "you" ? "page for you" : `${user}'s page`} is already open. Pass login or storageState the first time you ask for it.`);
      return existing.page;
    }
    /** @type {BrowserContextOptions} */
    const options = {};
    if (storageState) options.storageState = storageState;
    if (this.video) options.recordVideo = { dir: this.testInfo.outputPath(`video-${user}`) };
    const context = await this.browser.newContext(options);
    try {
      await grantClipboard(context);
      // The bar's styles, on every document this user opens. See captions.js.
      if (this.captions) await context.addInitScript(adoptCaptionStyles, CAPTION_CSS);
      const actions = this.measure || this.delay ? await watchActions(context) : null;
      const app = watchApp(context, () => this.current?.n ?? this.lastLine);
      if (this.delay) await delayData(context, this.delay);
      // The video starts while the page opens, not when newPage returns. On a
      // slow machine that takes over a second, so read the time first: steps
      // then line up with the video instead of landing a second early.
      const startsAt = this.recorder.elapsed();
      const page = await context.newPage();
      /** @type {UserPage} */
      const opened = { context, page, startsAt, captioned: Boolean(this.captions) && canCaption(page), caption: null, actions, app };
      if (opened.captioned && this.captions) await page.screencast.showActions(actionsFor(this.captions.position));
      if (login) await login(context, page);
      this.pages.set(user, opened);
      if (this.caption) await this.#showCaption(user, opened);
      return page;
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  /**
   * The value a `${name}` had in this run, such as a link the app made.
   * @param {string} name
   * @param {unknown} value
   * @param {{secret?: boolean}} [options] a secret's value is never written to the run
   */
  value(name, value, options) {
    this.recorder.value(name, value, options);
  }

  /**
   * Who played a user in this run, as launched: "a script", or the agent, its version and model.
   * @param {string} user
   * @param {string} who like "a script" or "Claude Code 2.4.1, opus"
   */
  playedBy(user, who) {
    this.recorder.playedBy(user, who);
  }

  /**
   * Mark a line blocked: setup or the environment broke.
   * @param {number|string} line a line number, an action's sentence, or a check id
   * @param {{reason: string, cause?: "environment"|"test"|"product"}} why
   */
  blocked(line, why) {
    this.recorder.blocked(line, why);
  }

  /**
   * Do one action line, then save a screenshot of the page of the user who did it.
   * A thrown error marks the step failed with cause "test" and stops the test.
   * @param {number|string} line the line number (from 1) or the action's sentence
   * @param {{by: string, caption?: string}} who who does it: "you" or a name from the journey's users.
   *   caption: one plain sentence for a paced video, like "You sign up with your email." Without one, the video shows the line.
   * @param {() => Promise<unknown>} action
   */
  async step(line, { by, caption } = /** @type {{by: string}} */ ({}), action) {
    const plan = this.recorder.actionLine(line);
    this.recorder.knows(by);
    this.#forgetActions();
    const at = this.recorder.elapsed();
    this.current = { line: plan.n, n: plan.n, says: plan.says, by };
    this.lastLine = plan.n;
    await this.#narrate(caption ? { by, text: shortCaption(caption) } : { by, lead: userLabel(by), text: shortCaption(fillValues(plan.says, this.recorder.values)) });
    /** @type {import("./measure.js").ActionTime[]} */
    let actions = [];
    await inStep(plan.says, async () => {
      let failure;
      try {
        await action();
      } catch (thrown) {
        failure = thrown;
      }
      const took = round(this.recorder.elapsed() - at);
      actions = await this.#actions(by);
      try {
        this.recorder.step(plan.n, {
          by,
          status: failure ? "failed" : "done",
          at,
          took,
          screenshots: await this.#screenshot(by),
          ...(failure ? { cause: "test", reason: firstLine(failure) } : {}),
        });
      } finally {
        this.current = null;
      }
      if (failure) {
        await this.#failed(plan.n, plan.says, by);
        throw failure;
      }
      await wait(this.pause);
    });
    await this.#measure(plan.n, by, actions);
  }

  /**
   * Prove one check. Return {passed, proof, evidence}. Return passed: false
   * (with a reason) when the product did the wrong thing. A thrown error, or
   * returning nothing, means it couldn't be checked: blocked, with cause "test".
   * A replay has no one to ask, so a missing proof or reason gets a plain one
   * and the run can still be written.
   * @param {string} id the check's id from the journey
   * @param {{by: string, caption?: string}} who whose view it is about: "you" or a name from the journey's users.
   *   caption: one plain sentence for a paced video while it runs, like "Checking that the new project shows in Your projects."
   * @param {() => Promise<CheckResult>} prove may return caption too: the verdict's sentence, like "the new project is not in Your projects."
   */
  async check(id, { by, caption } = /** @type {{by: string}} */ ({}), prove) {
    const plan = this.recorder.checkLine(id);
    this.recorder.knows(by);
    this.#forgetActions();
    const at = this.recorder.elapsed();
    this.current = { line: id, n: plan.n, says: plan.check, by };
    this.lastLine = plan.n;
    await this.#narrate(caption ? { by, text: shortCaption(caption) } : { by, lead: "Checking", text: shortCaption(fillValues(plan.check, this.recorder.values)) });
    /** @type {import("./measure.js").ActionTime[]} */
    let actions = [];
    await inStep(`check: ${plan.check}`, async () => {
      /** @type {CheckResult} */
      let result;
      try {
        result = (await prove()) ?? { verdict: "blocked", cause: "test", reason: "The check returned nothing." };
      } catch (thrown) {
        result = { verdict: "blocked", cause: "test", proof: THREW, reason: firstLine(thrown) };
      }
      const verdict = result.verdict ?? (result.passed ? "passed" : "failed");
      const took = round(this.recorder.elapsed() - at);
      actions = await this.#actions(by);
      try {
        this.recorder.check(id, {
          by,
          verdict,
          proof: result.proof ?? (verdict === "passed" || verdict === "failed" ? NO_PROOF : undefined),
          evidence: this.#fullUrls(result.evidence ?? []),
          at,
          took,
          screenshots: await this.#screenshot(by),
          // A reason explains a check that didn't pass; on a pass it is dropped.
          cause: verdict === "passed" ? undefined : result.cause,
          reason: verdict === "passed" ? undefined : (result.reason ?? (verdict === "failed" ? "It was not true when checked." : undefined)),
        });
      } finally {
        this.current = null;
      }
      // The verdict as the run will say it: a pass without its proof shows as not checked, with why.
      const settled = settleCheck(/** @type {import("../format/runfile.js").CheckStep} */ (this.recorder.recorded.get(plan.n)));
      if (settled.verdict === "failed" || settled.verdict === "blocked") await this.#failed(plan.n, plan.check, by);
      this.sinceLine = plan.n + 1;
      const why = settled.verdict === verdict && result.caption ? result.caption : ((settled.verdict === "passed" ? settled.proof : settled.reason) ?? plan.check);
      await this.#narrate({ by, verdict: settled.verdict, text: shortCaption(lowerFirst(why)) });
      await wait(this.pause * CHECK_PAUSES);
    });
    await this.#measure(plan.n, by, actions);
  }

  /**
   * What a user's page reported during the line. Read before the line's
   * screenshot: Playwright changes the page to take one (it hides the caret),
   * and that is not the product answering a click.
   * @param {string} user
   */
  async #actions(user) {
    return (await this.pages.get(user)?.actions?.take()) ?? [];
  }

  /**
   * Keep what the app reported to each user at the first line that failed.
   * @param {number} line
   * @param {string} says
   * @param {string} by
   */
  async #failed(line, says, by) {
    this.failure ??= { line, says, by, since: Math.min(this.sinceLine, line), users: await captureUsers(this.pages, this.recorder.secretValues()) };
  }

  /** Drop what the pages reported before this line: setup, and what another user's line caused. */
  #forgetActions() {
    // After a check, what the app reported starts over when the next line does.
    const afterCheck = this.lastLine !== null && this.sinceLine > this.lastLine;
    for (const opened of this.pages.values()) {
      opened.actions?.forget();
      if (afterCheck) opened.app.clear();
    }
  }

  /**
   * Measure the screen of the user who did a line, after the line's time and
   * screenshot are recorded, so neither includes it. A slow replay keeps only
   * the action times.
   * @param {number} line
   * @param {string} user
   * @param {import("./measure.js").ActionTime[]} actions
   */
  async #measure(line, user, actions) {
    const opened = this.pages.get(user);
    if (!opened || !(this.measure || this.delay)) return;
    if (this.delay || !this.measure) return void this.measured.push({ line, user, actions });
    try {
      if (opened.captioned) await opened.page.screencast.hideOverlays();
      try {
        this.measured.push({ line, user, url: pageUrl(opened.page), ...(await measureScreen(opened.page, { phone: this.measure !== "wide" })), actions });
      } finally {
        if (opened.captioned) await opened.page.screencast.showOverlays();
      }
    } catch {
      // A closed page can't be measured. The review says "not measured" for that line.
    }
  }

  /**
   * Put a line's caption on every user's page.
   * @param {import("./captions.js").Caption} caption
   */
  async #narrate(caption) {
    if (!this.captions) return;
    this.caption = caption;
    await Promise.all([...this.pages].map(([user, opened]) => this.#showCaption(user, opened)));
  }

  /**
   * @param {string} user
   * @param {UserPage} opened
   */
  async #showCaption(user, opened) {
    if (!opened.captioned || !this.caption) return;
    try {
      opened.caption = await replaceCaption(opened.page, captionHtml(this.caption, user, this.captions?.position), opened.caption);
    } catch {
      // A closed page can't show a caption; the run goes on without it.
    }
  }

  /**
   * Close every user's context, keep their videos, and attach the run.
   * Safe to call twice: the second call returns the first result.
   */
  async finish() {
    this.finished ??= this.#finish();
    return this.finished;
  }

  async #finish() {
    if (this.current) {
      const { line, n, says, by } = this.current;
      this.recorder.blocked(line, { by, cause: "test", reason: "The test stopped during this line: it timed out or was cancelled." });
      await this.#failed(n, says, by);
    }
    // Closing a context finishes its video. Every user's closes at once, so a run with more users does not wait longer.
    await Promise.all([...this.pages.values()].map(({ context }) => context.close()));
    for (const [user, { page, startsAt }] of this.pages) {
      const video = page.video();
      if (video) this.recorder.attach({ name: `${user}.webm`, path: await video.path(), kind: "video", starts_at: startsAt, tags: { user, ...(this.paced ? {} : { paced: false }) } });
    }
    if (this.delay) {
      console.log(slowReport(this.delay, this.measured));
      return this.recorder.result().run;
    }
    for (const { line, user, ...measured } of this.measured) {
      this.recorder.attach({ name: `measure-${line}.txt`, body: this.recorder.redact(JSON.stringify(measured)), kind: "capture", tags: { user } });
    }
    if (this.failure) {
      // Redacted now, so a secret set after the failure is still kept out.
      const report = failureReport({ ...this.failure, redact: (text) => this.recorder.redact(text) });
      this.recorder.attach({ name: "failure.json", body: JSON.stringify(report), kind: "capture", tags: { line: report.line } });
      this.recorder.attach({ name: "failure.md", body: failureMarkdown(report), kind: "capture", tags: { line: report.line } });
    }
    const { run, files } = this.recorder.result();
    const secrets = this.recorder.secretValues();
    if (secrets.length) await this.testInfo.attach(SECRET_ATTACHMENT, { body: Buffer.from(JSON.stringify(secrets)), contentType: "application/json" });
    for (const [name, body] of files) await this.testInfo.attach(`${FILE_ATTACHMENT}${name}`, { body });
    await this.testInfo.attach(RUN_ATTACHMENT, { body: JSON.stringify(run), contentType: "application/json" });
    return run;
  }

  /**
   * A screenshot of the user's page, with the address it was taken on (no query or fragment).
   * @param {string} user
   */
  async #screenshot(user) {
    const opened = this.pages.get(user);
    if (!opened) return [];
    // Cover the field before the shot. Put the value back only when something
    // changed, so a page with no secret pays for one call, not two.
    let covered = false;
    try {
      covered = (await opened.page.evaluate(applyMask, { secrets: this.recorder.secretValues(), mask: MASK })) === true;
    } catch {
      // A page that cannot run the mask still gets a screenshot.
    }
    try {
      return [{ image: await cleanScreenshot(opened.page, opened.captioned ? this.captions : null), url: pageUrl(opened.page) }];
    } catch {
      return []; // A closed page can't be captured; the step still records what happened.
    } finally {
      if (covered) {
        try {
          await opened.page.evaluate(restoreMask);
        } catch {
          // A closed page has nothing to put back.
        }
      }
    }
  }

  /**
   * Evidence urls as full addresses, so a reader can tell which build they
   * came from. A relative url is read against the page of the login it came
   * from (without its query or fragment), or the test's baseURL. A full url
   * the author wrote is kept as written.
   * @param {import("../format/runfile.js").Evidence[]} evidence
   */
  #fullUrls(evidence) {
    return evidence.map((item) => {
      if (typeof item?.url !== "string" || isFullUrl(item.url)) return item;
      const base = pageUrl(item.login === undefined ? undefined : this.pages.get(item.login)?.page) ?? this.testInfo.project?.use?.baseURL;
      try {
        return base ? { ...item, url: new URL(item.url, base).href } : item;
      } catch {
        return item;
      }
    });
  }
}

// A separate test object, so adding journeys never changes Playwright's own.
// The fixture finishes the run after the test, even when it threw or timed
// out, so every run writes a folder.
/**
 * @typedef {import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions} TestArgs
 * @typedef {import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions} WorkerArgs
 * @typedef {{_journeyRun: {run: JourneyRun | null}, journeyCaptions: import("./captions.js").CaptionsOption | undefined, journeyVideo: VideoOption | undefined}} JourneyFixtures
 *   journeyCaptions: the project's default captions, set in the Playwright config's use, like
 *   use: { journeyCaptions: { position: "bottom" } }. A test's own captions option wins.
 *   journeyVideo: the project's default for video, like use: { journeyVideo: false } for a run
 *   that only needs pass or fail, or use: { journeyVideo: "paced" }. A test's own video option wins.
 */
const journeyTest = base.extend(/** @type {import("@playwright/test").Fixtures<JourneyFixtures, {}, TestArgs, WorkerArgs>} */ ({
  journeyCaptions: [undefined, { option: true }],
  journeyVideo: [undefined, { option: true }],
  _journeyRun: async ({}, use) => {
    /** @type {{run: JourneyRun | null}} */
    const holder = { run: null };
    await use(holder);
    if (holder.run) await holder.run.finish();
  },
}));

/**
 * @typedef {{case?: string, video?: VideoOption, captions?: import("./captions.js").CaptionsOption, pause?: number, measure?: MeasureOption,
 *   repos?: Array<{repo: string, commit?: string, branch?: string}>, tags?: Record<string, unknown>}} JourneyOptions
 * @typedef {(args: {journey: JourneyRun, browser: import("@playwright/test").Browser, request: import("@playwright/test").APIRequestContext}) => Promise<void>} JourneyBody
 */

/**
 * Declare a Playwright test for a journey file. The test fails unless the run's
 * result is passed.
 *   test.journey("journeys/x.journey.yaml", async ({ journey }) => { ... })
 *   test.journey("journeys/x.journey.yaml", { case: "not-now", video: false }, async ({ journey }) => { ... })
 * Each user's screen is recorded with no waiting. The review page shows each
 * line under the video and holds on it.
 * Pass video: "paced" for a video to share as a raw file: the run waits after
 * each line, and the video shows the line in progress at the top.
 * For a paced video, pass captions: false to turn that off, captions: { position: "bottom" } to
 * move it (or set journeyCaptions in the config's use for every test), and pause (ms after each action; a
 * check's verdict stays five times as long) to change the pacing.
 * Set journeyVideo in the config's use for every test: "paced", or false to record no video.
 * After each line the user's screen is measured for a review and saved as
 * measure-<line>.txt. Measuring sets the page 375 px wide for a moment. Pass
 * measure: "wide" when that breaks a line, or measure: false for none.
 * With JOURNEYS_DELAY_MS set, the test is a slow replay: each data request is
 * held that long, each action's time is printed, and no run is written.
 * Pass repos when the code that ran is a deployed preview, not this checkout;
 * without it the run lists the local git checkout.
 * @param {string} file path to a .journey.yaml file
 * @param {JourneyOptions | JourneyBody} options
 * @param {JourneyBody} [body]
 */
function declareJourney(file, options, body) {
  if (typeof options === "function") [options, body] = [{}, options];
  const journey = loadJourney(file);
  const caseName = options.case ? journey.cases?.find((c) => c.id === options.case)?.name : null;
  atCaller(journeyTest, declareJourney)(caseName ? `${journey.title}: ${caseName}` : journey.title, async ({ browser, request, _journeyRun, journeyCaptions, journeyVideo }, testInfo) => {
    const problem = missingTarget({ baseURL: testInfo.project.use?.baseURL, webServer: testInfo.config?.webServer });
    if (problem) throw new Error(problem);
    const captions = captionSettings(options.captions, journeyCaptions) ?? false;
    const delay = Number(process.env.JOURNEYS_DELAY_MS) || 0;
    const run = new JourneyRun({ file, caseId: options.case ?? null, browser, testInfo, video: options.video ?? journeyVideo ?? true, captions, pause: options.pause, measure: options.measure, delay, repos: options.repos, tags: options.tags });
    _journeyRun.run = run;
    // body is set: it is the last argument, or options when only two are given.
    await /** @type {JourneyBody} */ (body)({ journey: run, browser, request });
    const written = await run.finish();
    if (!delay && written.result !== "passed") {
      throw new Error(`The journey run is ${written.result.replaceAll("_", " ")}:\n- ${/** @type {string[]} */ (written.not_verified).join("\n- ")}`);
    }
  });
}

/** Playwright's test, plus test.journey. */
export const test = Object.assign(journeyTest, { journey: declareJourney });

/**
 * A Playwright step inside a test; outside one (unit tests) just run it.
 * @param {string} title
 * @param {() => Promise<void>} fn
 */
async function inStep(title, fn) {
  try {
    base.info();
  } catch {
    return fn();
  }
  return base.step(title, fn);
}

/** Copying and pasting a link needs clipboard access. Browsers that don't have it skip it. */
/** @param {import("@playwright/test").BrowserContext} context */
async function grantClipboard(context) {
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  } catch {
    // Not every browser knows these permissions.
  }
}

/**
 * The page's address, when it is a web page (not about:blank), without its
 * query or fragment. Those can hold a one-time sign-in token, an OAuth code or
 * an access token, and the run is published.
 * @param {import("@playwright/test").Page | undefined} page
 */
function pageUrl(page) {
  const url = page?.url();
  if (!isFullUrl(url)) return undefined;
  const address = new URL(/** @type {string} */ (url));
  address.search = "";
  address.hash = "";
  return address.href;
}

/** @param {unknown} error what was thrown */
function firstLine(error) {
  return String(/** @type {Error | undefined} */ (error)?.message ?? error).split("\n")[0].replace(/\u001b\[[0-9;]*m/g, "").trim() || "It failed.";
}

/** "The link works" as "the link works", but "Q3 plan" stays. @param {string} text */
const lowerFirst = (text) => (/^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);

/** @param {number} ms */
const wait = (ms) => (ms > 0 ? new Promise((done) => setTimeout(done, ms)) : Promise.resolve());

/** To the millisecond: lines in a video with no pauses are a few hundredths of a second apart. @param {number} seconds */
const round = (seconds) => Math.round(seconds * 1000) / 1000;
