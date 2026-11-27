import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "journeysfirst/playwright";
import { REPO, freePort, markTime, playwrightOf, run, sayIfFailed, show } from "./support.js";

const EXAMPLE = join(REPO, "examples/claims-review");
const CLI = join(REPO, "packages/core/bin/journeysfirst.js");

test.journey("journeys/see-what-got-worse-for-each-user.journey.yaml", { measure: false }, async ({ journey }) => {
  test.setTimeout(180_000);
  const started = Date.now();
  /** @type {import("node:child_process").ChildProcess | null} */
  let review = null;
  try {
    const agent = await journey.page("agent");
    const you = await journey.page("you");
    const dir = mkdtempSync(join(tmpdir(), "jf-compare-"));
    const [mainRuns, runs] = [join(dir, "main-runs"), join(dir, "journey-runs")];
    /** @param {string} out @param {Record<string, string>} env */
    const play = (out, env) => run(EXAMPLE, process.execPath, [playwrightOf(EXAMPLE), "test", "--output", join(out, "test-results")], { ...env, JOURNEYSFIRST_RUNS_DIR: out });
    /** @param {string} out */
    const newest = (out) => {
      const made = /wrote (.+)\/run\.json/.exec(played[out]?.output ?? "")?.[1];
      return made ? { folder: made, run: JSON.parse(readFileSync(join(made, "run.json"), "utf8")) } : null;
    };
    /** @type {Record<string, {status: number | null, output: string}>} */
    const played = {};

    await journey.step("The agent runs the journey on main and on the change.", { by: "agent", caption: "The agent runs the journey on main and on the change." }, async () => {
      played[mainRuns] = play(mainRuns, {});
      // The planted change: the billing code is under Details, then Billing.
      played[runs] = play(runs, { DEMO_MOVED_FIELD: "1" });
      sayIfFailed("main", played[mainRuns]);
      sayIfFailed("the change", played[runs]);
      await show(agent, "The agent runs the journey on main and on the change", `${played[mainRuns].output}\n${played[runs].output}`);
    });

    const [onMain, onChange] = [newest(mainRuns), newest(runs)];
    await journey.check("both-runs-pass", { by: "agent", caption: "Checking that every check passed in both runs." }, async () => {
      const results = [onMain?.run.result, onChange?.run.result];
      const passed = results.every((result) => result === "passed");
      return { passed, proof: "Read the result of each run.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "agent", saw: `main ${results[0]}, the change ${results[1]}` }], reason: "A run did not pass, so there is nothing to compare.", caption: passed ? "every check passed in both runs." : "a run did not pass." };
    });

    let printed = "";
    await journey.step("The agent compares the change's run with main's.", { by: "agent", caption: "The agent compares the change's run with main's." }, async () => {
      printed = run(REPO, process.execPath, [CLI, "compare", runs, "--main", mainRuns]).output;
      await show(agent, "journeysfirst compare", printed);
    });

    await journey.check("agent-reads-got-worse", { by: "agent", caption: "Checking what the agent reads about you." }, async () => {
      const line = printed.split("\n").find((text) => /^\s*you\s/.test(text)) ?? "";
      const passed = /got worse/i.test(line) && /billing code/i.test(line) && /2 clicks/.test(line);
      return { passed, proof: "Read the line for you in what compare printed.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "agent", saw: line.trim() || "no line for you" }], reason: "Compare did not say that your work got worse.", caption: passed ? "the agent reads that the billing code is 2 clicks further." : "compare did not say what got worse." };
    });

    const port = freePort();
    await journey.step("You open the compare page.", { by: "you", caption: "You open the compare page." }, async () => {
      review = spawn(process.execPath, [CLI, "review", runs, "--main", mainRuns, "--port", port], { cwd: REPO, stdio: "pipe" });
      await new Promise((done, fail) => {
        review?.stdout?.on("data", (chunk) => String(chunk).includes("journeysfirst review:") && done(undefined));
        review?.on("exit", () => fail(new Error("The review page did not start.")));
      });
      await you.goto(`http://127.0.0.1:${port}/compare/review-a-claim/${basename(onChange?.folder ?? "none")}`);
    });
    const seen = (/** @type {string} */ saw) => [{ source: "page", url: you.url(), login: "you", saw }];

    await journey.check("you-see-got-worse", { by: "you", caption: "Checking what the page says about you." }, async () => {
      const row = (await you.locator(".rows .row").first().innerText().catch(() => "")).replace(/\s+/g, " ");
      const passed = /got worse/i.test(row) && /billing code/i.test(row) && /still pass/i.test(row) && !(await you.locator(".verdict.failed, .verdict.broke").count());
      return { passed, proof: "Read your line at the top of the compare page.", evidence: seen(row || "no line for you"), reason: "The page does not say that your work got worse while the checks pass.", caption: passed ? "you got worse, and every check still passes." : "the page does not say what got worse." };
    });

    const step = you.locator(".cmp-step", { hasText: "billing code" }).last();
    /** The screen that shows in the line's frame: whose it is, its address and its box. */
    const showing = () => step.locator(".cmp-frame figure").evaluateAll((list) => list.filter((f) => getComputedStyle(f).visibility === "visible").map((f) => {
      const img = f.querySelector("img");
      const [box, frame] = [img?.getBoundingClientRect(), /** @type {Element} */ (f.parentElement).getBoundingClientRect()];
      // Where the screen sits in its frame, so a page that scrolled does not read as a screen that moved.
      return { side: f.dataset.side, src: img?.getAttribute("src") ?? "", box: box ? [box.left - frame.left, box.top - frame.top, box.width].map(Math.round) : [] };
    }));

    await journey.check("you-see-both-sides", { by: "you", caption: "Checking the line that differs." }, async () => {
      const clicks = await step.locator(".cmp-side").evaluateAll((list) => list.map((side) => side.querySelectorAll(".cmp-actions li").length));
      const shown = await showing();
      const wide = shown.length === 1 && shown[0].side === "change" && shown[0].box[2] > (await step.evaluate((e) => e.getBoundingClientRect().width)) * 0.9;
      const passed = wide && clicks.length === 2 && clicks[1] - clicks[0] === 2 && /same/i.test(await you.locator("main").innerText());
      if (passed) await step.scrollIntoViewIfNeeded();
      return { passed, proof: "Read the clicks on each side of the line where you see the billing code, and the screen under them.", evidence: seen(`main ${clicks[0] ?? "no"} clicks, the change ${clicks[1] ?? "no"} clicks, ${wide ? "the change's screen at full width" : "no full-width screen of the change"}`), reason: "The page does not show the extra clicks and the change's screen.", caption: passed ? "the change took 2 more clicks, and its screen is under them." : "the clicks or the screen are not there." };
    });

    const before = (await showing())[0];
    /** @type {Awaited<ReturnType<typeof showing>>} */
    let flipped = [];
    await journey.step("Flip that line's screen to main.", { by: "you", caption: "You flip the screen to main." }, async () => {
      await step.locator('.tab[data-tab="main"]').click();
      flipped = await showing();
    });

    await journey.check("you-flip-to-main", { by: "you", caption: "Checking that the screen flips in place." }, async () => {
      await step.getByRole("tab", { selected: true }).press("ArrowLeft");
      const back = await showing();
      const inPlace = flipped.length === 1 && flipped[0].side === "main" && flipped[0].src !== before?.src && String(flipped[0].box) === String(before?.box);
      const passed = inPlace && back.length === 1 && back[0].src === before?.src;
      return { passed, proof: "Flipped the line's screen to main with a click, and back with an arrow key.", evidence: seen(`main's screen ${inPlace ? "in the same place" : "not in the same place"}, then ${back[0]?.side === "change" ? "the change's again" : "no change screen"}`), reason: "The screen does not flip to main in place and back.", caption: passed ? "main's screen shows in the same place, then the change's again." : "the screen does not flip in place." };
    });

    await journey.step("Choose side by side for that line's screen.", { by: "you", caption: "You choose side by side." }, async () => {
      await step.locator('.tab[data-tab="both"]').click();
    });

    await journey.check("you-see-side-by-side", { by: "you", caption: "Checking that both screens show at once." }, async () => {
      const shown = await showing();
      const passed = shown.length === 2 && shown[0].side === "main" && shown[1].side === "change" && shown[0].src !== shown[1].src && shown[0].box[2] === shown[1].box[2];
      return { passed, proof: "Chose side by side on the line's switch and looked at its frame.", evidence: seen(`${shown.length} screens showing: ${shown.map((s) => s.side).join(", ") || "none"}`), reason: "The page does not show main's screen and the change's at once.", caption: passed ? "main's screen and the change's show at once, at the same size." : "the two screens do not show at once." };
    });

    await journey.check("you-see-it-was-planted", { by: "you", caption: "Checking that the page says the change was planted." }, async () => {
      const shown = await you.locator("main").innerText();
      const passed = /planted/i.test(shown);
      return { passed, proof: "Read the note at the top of the compare page.", evidence: seen(passed ? "the page says the change was planted" : "no word that it was planted"), reason: "The page does not say the change was planted.", caption: passed ? "the page says the change was planted." : "the page does not say it was planted." };
    });
  } finally {
    /** @type {import("node:child_process").ChildProcess | null} */ (review)?.kill();
    markTime("see-what-got-worse-for-each-user pass", Date.now() - started);
  }
});
