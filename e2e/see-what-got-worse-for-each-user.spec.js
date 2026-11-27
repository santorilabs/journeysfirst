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

    await journey.check("you-see-both-sides", { by: "you", caption: "Checking the lines that differ." }, async () => {
      const step = you.locator(".cmp-step", { hasText: "billing code" }).last();
      const clicks = await step.locator(".cmp-side").evaluateAll((list) => list.map((side) => side.querySelectorAll(".cmp-actions li").length));
      const boxes = await step.locator(".cmp-side").evaluateAll((list) => list.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.top]));
      const beside = boxes.length === 2 && boxes[0][1] === boxes[1][1] && boxes[0][0] < boxes[1][0];
      const passed = beside && clicks[1] - clicks[0] === 2 && (await step.locator("img").count()) === 2 && /unchanged|same/i.test(await you.locator("main").innerText());
      if (passed) await step.scrollIntoViewIfNeeded();
      return { passed, proof: "Read both sides of the line where you see the billing code.", evidence: seen(`main ${clicks[0] ?? "no"} clicks, the change ${clicks[1] ?? "no"} clicks, ${beside ? "side by side" : "not side by side"}`), reason: "The page does not show main beside the change with the extra clicks.", caption: passed ? "main is beside the change, with 2 more clicks." : "the two sides are not there." };
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
