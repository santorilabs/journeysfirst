import { RunRecorder } from "./recorder.js";
import { DEFAULT_PAUSE } from "../shared/display.js";
export { expect } from "@playwright/test";
export declare const RUN_ATTACHMENT = "journeysfirst-run";
export declare const FILE_ATTACHMENT = "journeysfirst-file:";
/** Declared secret values for the reporter, so it can redact a trace. Not a run file. */
export declare const SECRET_ATTACHMENT = "journeysfirst-secrets";
export declare const THREW = "The check threw an error before it could prove anything.";
export declare const NO_PROOF = "The runner did not say how it was proven.";
export { DEFAULT_PAUSE };
export type CheckResult = {
    passed?: boolean;
    verdict?: "passed" | "failed" | "blocked" | "not_checked";
    proof?: string;
    evidence?: import("../format/runfile.js").Evidence[];
    cause?: "product" | "test" | "environment";
    reason?: string;
    caption?: string;
};
export type BrowserContextOptions = import("@playwright/test").BrowserContextOptions;
export type UserPage = {
    context: import("@playwright/test").BrowserContext;
    page: import("@playwright/test").Page;
    startsAt: number;
    captioned: boolean;
    caption: {
        dispose: () => Promise<void>;
    } | null;
    actions: import("./measure.js").Watch | null;
    app: import("./reported.js").AppWatch;
};
export type RecordingOption = boolean | "paced";
export type MeasureOption = boolean | "wide";
/**
 * @typedef {{passed?: boolean, verdict?: "passed"|"failed"|"blocked"|"not_checked", proof?: string,
 *   evidence?: import("../format/runfile.js").Evidence[], cause?: "product"|"test"|"environment", reason?: string,
 *   caption?: string}} CheckResult caption: one plain sentence for a paced video after the verdict word,
 *   like "the new project is not in Your projects." It shows as "Failed: the new project is not in Your projects."
 * @typedef {import("@playwright/test").BrowserContextOptions} BrowserContextOptions
 * @typedef {{context: import("@playwright/test").BrowserContext, page: import("@playwright/test").Page, startsAt: number,
 *   captioned: boolean, caption: {dispose: () => Promise<void>} | null, actions: import("./measure.js").Watch | null,
 *   app: import("./reported.js").AppWatch}} UserPage
 * @typedef {boolean | "paced"} RecordingOption true: record each user's screen with no waiting; the review page holds on each line.
 *   "paced": the run waits after each line and draws the caption bar and click marks into the video, for a clip shared as a raw file.
 *   false: record no video.
 * @typedef {boolean | "wide"} MeasureOption true: measure each user's screen after every line, at the run's width and at 375 px.
 *   "wide": never resize the page. false: do not measure.
 */
/**
 * How a run records: the test's own recording option, else the project's, else a video with no waiting.
 * @param {RecordingOption | undefined} test the test.journey option
 * @param {RecordingOption | undefined} project the recording option from the Playwright config's use
 * @returns {RecordingOption}
 */
export declare function recordingSetting(test: RecordingOption | undefined, project: RecordingOption | undefined): RecordingOption;
export declare class JourneyRun {
    #private;
    recorder: RunRecorder;
    browser: import("@playwright/test").Browser;
    testInfo: import("@playwright/test").TestInfo;
    video: boolean;
    /** A paced video carries its own captions and pauses. For any other, the review page shows the lines and holds on each. */
    paced: boolean;
    /** Where the caption bar goes, or null for no captions. */
    captions: {
        position: import("./captions.js").Position;
    } | null;
    pause: number;
    measure: MeasureOption;
    delay: number;
    /** What was measured after each line. Written when the run finishes, so a secret set later is still kept out. */
    /** @type {Array<{line: number, user: string, url?: string, actions: import("./measure.js").ActionTime[], wide?: object, phone?: object}>} */
    measured: Array<{
        line: number;
        user: string;
        url?: string;
        actions: import("./measure.js").ActionTime[];
        wide?: object;
        phone?: object;
    }>;
    /** @type {Map<string, UserPage>} */
    pages: Map<string, UserPage>;
    /** The caption on every page now. A page opened later shows it too. @type {import("./captions.js").Caption | null} */
    caption: import("./captions.js").Caption | null;
    /** The line in progress, so a run cut short by a timeout still says where it stopped. */
    /** @type {{line: number|string, n: number, says: string, by: string} | null} */
    current: {
        line: number | string;
        n: number;
        says: string;
        by: string;
    } | null;
    /** The last line started, and the first line after the last check. A failure report covers from there. */
    lastLine: number | null;
    sinceLine: number;
    /** What the app reported at the first failed line, written when the run finishes. @type {import("./reported.js").Captured | null} */
    failure: import("./reported.js").Captured | null;
    /** @type {Promise<import("../format/runfile.js").Run> | null} */
    finished: Promise<import("../format/runfile.js").Run> | null;
    /**
     * @param {{file: string, caseId: string|null, browser: import("@playwright/test").Browser, testInfo: import("@playwright/test").TestInfo,
     *   recording?: RecordingOption, captions?: import("./captions.js").CaptionsOption, pause?: number, measure?: MeasureOption, delay?: number,
     *   repos?: Array<{repo: string, commit?: string, branch?: string}>, tags?: Record<string, unknown>}} options
     *   captions: show the line in progress on each user's paced video (default on, at the top).
     *   false turns them off; {position: "bottom"} moves the bar.
     *   pause: ms to wait after each action, and five times that after a check so its verdict can be read (default 500 for a paced video, else 0).
     *   measure: save measure-<line>.txt after each line, for a review (default on).
     *   delay: ms to hold each data request, for a slow replay. A slow replay prints each action's time and writes no run.
     */
    constructor({ file, caseId, browser, testInfo, recording, captions, pause, measure, delay, repos, tags }: {
        file: string;
        caseId: string | null;
        browser: import("@playwright/test").Browser;
        testInfo: import("@playwright/test").TestInfo;
        recording?: RecordingOption;
        captions?: import("./captions.js").CaptionsOption;
        pause?: number;
        measure?: MeasureOption;
        delay?: number;
        repos?: Array<{
            repo: string;
            commit?: string;
            branch?: string;
        }>;
        tags?: Record<string, unknown>;
    });
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
    page(user?: string, { account, login, storageState }?: {
        account?: string | null;
        login?: (context: import("@playwright/test").BrowserContext, page: import("@playwright/test").Page) => Promise<unknown>;
        storageState?: BrowserContextOptions["storageState"];
    }): Promise<import("@playwright/test").Page>;
    /**
     * The value a `${name}` had in this run, such as a link the app made.
     * @param {string} name
     * @param {unknown} value
     * @param {{secret?: boolean}} [options] a secret's value is never written to the run
     */
    value(name: string, value: unknown, options?: {
        secret?: boolean;
    }): void;
    /**
     * Who played a user in this run, as launched: "a script", or the agent, its version and model.
     * @param {string} user
     * @param {string} who like "a script" or "Claude Code 2.4.1, opus"
     */
    playedBy(user: string, who: string): void;
    /**
     * Mark a line blocked: setup or the environment broke.
     * @param {number|string} line a line number, an action's sentence, or a check id
     * @param {{reason: string, cause?: "environment"|"test"|"product"}} why
     */
    blocked(line: number | string, why: {
        reason: string;
        cause?: "environment" | "test" | "product";
    }): void;
    /**
     * Do one action line, then save a screenshot of the page of the user who did it.
     * A thrown error marks the step failed with cause "test" and stops the test.
     * @param {number|string} line the line number (from 1) or the action's sentence
     * @param {{by: string, caption?: string}} who who does it: "you" or a name from the journey's users.
     *   caption: one plain sentence for a paced video, like "You sign up with your email." Without one, the video shows the line.
     * @param {() => Promise<unknown>} action
     */
    step(line: number | string, { by, caption }: {
        by: string;
        caption?: string;
    } | undefined, action: () => Promise<unknown>): Promise<void>;
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
    check(id: string, { by, caption }: {
        by: string;
        caption?: string;
    } | undefined, prove: () => Promise<CheckResult>): Promise<void>;
    /**
     * Close every user's context, keep their videos, and attach the run.
     * Safe to call twice: the second call returns the first result.
     */
    finish(): Promise<import("../format/runfile.js").Run>;
}
export type TestArgs = import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions;
export type WorkerArgs = import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions;
export type JourneyFixtures = {
    _journeyRun: {
        run: JourneyRun | null;
    };
    journeyCaptions: import("./captions.js").CaptionsOption | undefined;
    recording: RecordingOption | undefined;
};
export type JourneyOptions = {
    case?: string;
    recording?: RecordingOption;
    captions?: import("./captions.js").CaptionsOption;
    pause?: number;
    measure?: MeasureOption;
    repos?: Array<{
        repo: string;
        commit?: string;
        branch?: string;
    }>;
    tags?: Record<string, unknown>;
};
export type JourneyBody = (args: {
    journey: JourneyRun;
    browser: import("@playwright/test").Browser;
    request: import("@playwright/test").APIRequestContext;
}) => Promise<void>;
/**
 * @typedef {{case?: string, recording?: RecordingOption, captions?: import("./captions.js").CaptionsOption, pause?: number, measure?: MeasureOption,
 *   repos?: Array<{repo: string, commit?: string, branch?: string}>, tags?: Record<string, unknown>}} JourneyOptions
 * @typedef {(args: {journey: JourneyRun, browser: import("@playwright/test").Browser, request: import("@playwright/test").APIRequestContext}) => Promise<void>} JourneyBody
 */
/**
 * Declare a Playwright test for a journey file. The test fails unless the run's
 * result is passed.
 *   test.journey("journeys/x.journey.yaml", async ({ journey }) => { ... })
 *   test.journey("journeys/x.journey.yaml", { case: "not-now", recording: false }, async ({ journey }) => { ... })
 * Each user's screen is recorded with no waiting. The review page shows each
 * line under the video and holds on it.
 * Pass recording: "paced" for a video to share as a raw file: the run waits after
 * each line, and the video shows the line in progress at the top.
 * For a paced video, pass captions: false to turn that off, captions: { position: "bottom" } to
 * move it (or set journeyCaptions in the config's use for every test), and pause (ms after each action; a
 * check's verdict stays five times as long) to change the pacing.
 * Pass recording: false to record no video. Set recording in the config's use for every test.
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
declare function declareJourney(file: string, options: JourneyOptions | JourneyBody, body?: JourneyBody): void;
/** Playwright's test, plus test.journey. */
export declare const test: import("@playwright/test").TestType<import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions & JourneyFixtures, import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions> & {
    journey: typeof declareJourney;
};
