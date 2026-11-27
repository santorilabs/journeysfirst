import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "journeysfirst/playwright";
import { binOf, discoverInit, freePort, install, markTime, newestRun, outside, packs, playwrightOf, run, show } from "./support.js";

const broken = process.env.JF_BROKEN === "main";

test.journey("journeys/hand-a-project-to-a-new-agent.journey.yaml", { measure: false }, async ({ journey }) => {
  test.setTimeout(240_000);
  const started = Date.now();
  try {
    const you = await journey.page("you");
    const agent = await journey.page("agent");
    const teammate = await journey.page("teammate");
    const saved = packs();
    const source = broken ? saved.mainTree : saved.repo;
    const tarball = broken ? saved.mainTgz : saved.branchTgz;
    const found = discoverInit([source]);
    let dir = "";
    let setupLog = "";
    /** @type {string[]} */
    let files = found.files;

    await journey.step("The agent finds Journeys First in the project.", { by: "agent", caption: "The agent finds Journeys First." }, async () => {
      await show(agent, "The agent finds Journeys First", found.from ? `Found in ${found.from}` : "Journeys First was not found in the project.");
    });

    await journey.step("The agent finds the instructions that come with it.", { by: "agent", caption: "The agent finds the instructions." }, async () => {
      await show(agent, "The agent finds the instructions", found.command ? `${found.command}\nfrom ${found.from}` : "No setup instruction was found.");
    });

    await journey.step("The agent sets the project up.", { by: "agent", caption: "The agent sets the project up." }, async () => {
      try {
        dir = install(tarball);
        const again = discoverInit([dir]);
        files = [...files, ...again.files];
        if (!found.command && again.command) found.command = again.command;
        setupLog = found.command ? run(dir, process.execPath, [binOf(dir), "init"]).output : "No setup instruction was found.";
      } catch (error) {
        setupLog = /** @type {Error} */ (error).message;
      }
      await show(agent, "The agent installs it and sets the project up", setupLog);
    });

    let first = { status: 1, output: setupLog };
    await journey.step("The agent tries the sample.", { by: "agent", caption: "The agent tries the sample." }, async () => {
      if (dir) first = run(dir, process.execPath, [playwrightOf(dir), "test"], { JOURNEYS_PORT: freePort() });
      await show(agent, "The agent runs the first journey", first.output);
    });

    const folder = dir ? newestRun(dir, "see-the-example") : null;
    const runJson = folder ? JSON.parse(readFileSync(join(folder, "run.json"), "utf8")) : null;
    const summary = folder ? run(dir, process.execPath, [binOf(dir), "summary", folder]).output : first.output;
    const passedRun = first.status === 0 && runJson?.result === "passed";
    const stray = outside(files, [source, dir].filter(Boolean));

    await journey.check("agent-sees-the-pass", { by: "agent", caption: "Checking that the first run passed." }, async () => {
      await show(agent, "The first run", passedRun ? summary : first.output);
      return { passed: passedRun, proof: "The agent ran the first journey and read the result.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "agent", saw: passedRun ? "the first run passed" : "the first run did not pass" }], reason: "The first run did not pass.", caption: passedRun ? "the first run passed." : "the first run did not pass." };
    });

    await journey.check("only-what-is-here", { by: "agent", caption: "Checking that the agent stayed in the project." }, async () => {
      const passed = files.length > 0 && stray.length === 0 && Boolean(found.command);
      await show(agent, "Files the agent opened", (files.length ? files : ["none"]).join("\n") + (stray.length ? `\n\nOutside:\n${stray.join("\n")}` : ""));
      return { passed, proof: "Listed every file the agent opened.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "agent", saw: passed ? "only files from the project and the package" : "a file from outside, or no instruction" }], reason: "The agent opened a file from outside the project and the package, or found no instruction.", caption: passed ? "the agent used only what is here." : "the agent went outside the project." };
    });

    await journey.check("you-were-not-asked", { by: "you", caption: "Checking that you were not asked." }, async () => {
      await show(you, "No question for you", "You were not asked a question.");
      return { passed: true, proof: "The agent finished without asking anyone.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "you", saw: "no question" }], caption: "you were not asked." };
    });

    await journey.check("teammate-sees-the-run", { by: "teammate", caption: "Checking what the teammate sees." }, async () => {
      await show(teammate, "The same run", summary);
      return { passed: passedRun && /passed/i.test(summary), proof: "Showed the teammate the same summary.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "teammate", saw: passedRun ? "the same passing run" : "no passing run" }], reason: "The teammate did not see the passing run.", caption: passedRun ? "the teammate sees the run." : "the teammate does not see a passing run." };
    });

    await journey.check("teammate-sees-no-gap", { by: "teammate", caption: "Checking that no step was left undone." }, async () => {
      const gap = !passedRun || /not_checked|not run|left undone/i.test(summary);
      await show(teammate, "Nothing left undone", summary);
      return { passed: !gap, proof: "Read the summary for a step that did not run.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "teammate", saw: gap ? "a step left undone" : "no step left undone" }], reason: "The teammate saw a step left undone.", caption: gap ? "a step was left undone." : "no step was left undone." };
    });
  } finally {
    markTime(`hand-a-project-to-a-new-agent ${broken ? "fail" : "pass"}`, Date.now() - started);
  }
});
