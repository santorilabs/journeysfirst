import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "journeysfirst/playwright";
import { binOf, freePort, install, markTime, newestRun, packs, playwrightOf, run, show } from "./support.js";

const broken = process.env.JF_BROKEN === "main";

test.journey("journeys/start-from-an-empty-project.journey.yaml", { video: true, pause: 0, measure: false }, async ({ journey }) => {
  test.setTimeout(240_000);
  const started = Date.now();
  try {
    const you = await journey.page("you");
    const teammate = await journey.page("teammate");
    const tarball = broken ? packs().mainTgz : packs().branchTgz;
    let dir = "";
    let setupLog = "";

    await journey.step("Install it and set the project up.", { by: "you", caption: "You install it and set the project up." }, async () => {
      try {
        dir = install(tarball);
        setupLog = run(dir, process.execPath, [binOf(dir), "init"]).output;
      } catch (error) {
        setupLog = /** @type {Error} */ (error).message;
      }
      await show(you, "You install it and set the project up", setupLog);
    });

    let first = { status: 1, output: "" };
    await journey.step("Run the first journey.", { by: "you", caption: "You run the first journey." }, async () => {
      if (dir) first = run(dir, process.execPath, [playwrightOf(dir), "test"], { JOURNEYS_PORT: freePort() });
      else first = { status: 1, output: setupLog };
      await show(you, "You run the first journey", first.output);
    });

    const firstRun = dir ? newestRun(dir, "see-the-example") : null;
    const firstJson = firstRun ? JSON.parse(readFileSync(join(firstRun, "run.json"), "utf8")) : null;
    const summary = firstRun ? run(dir, process.execPath, [binOf(dir), "summary", firstRun]).output : first.output;

    await journey.check("first-run-passes", { by: "you", caption: "Checking that the first run passed." }, async () => {
      const passed = first.status === 0 && firstJson?.result === "passed";
      await show(you, "The first run", passed ? summary : first.output);
      return { passed, proof: "Ran the first journey and read its result.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "you", saw: passed ? "the first run passed" : "the first run did not pass" }], reason: "The first run did not pass.", caption: passed ? "the first run passed." : "the first run did not pass." };
    });

    await journey.check("teammate-sees-the-pass", { by: "teammate", caption: "Checking what the teammate sees." }, async () => {
      const passed = firstJson?.result === "passed" && /passed/i.test(summary);
      await show(teammate, "What the teammate sees", summary);
      return { passed, proof: "Showed the teammate the summary of the first run.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "teammate", saw: passed ? "the first run passed" : "no passing run" }], reason: "The teammate did not see a passing run.", caption: passed ? "the teammate sees the pass." : "the teammate does not see a pass." };
    });

    await journey.check("teammate-sees-no-error", { by: "teammate", caption: "Checking that the teammate sees no error." }, async () => {
      const passed = firstJson?.result === "passed" && !/\berror\b/i.test(summary) && !/\bfailed\b/i.test(summary);
      await show(teammate, "No error in the first run", summary);
      return { passed, proof: "Read the summary for an error or a failed check.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "teammate", saw: passed ? "no error in the summary" : "an error or a failed check" }], reason: "The teammate saw an error in the first run.", caption: passed ? "the teammate sees no error." : "the teammate sees an error." };
    });

    let doctor = { status: 1, output: "" };
    await journey.step("Leave the app address out of the setup.", { by: "you", caption: "You leave the app address out of the setup." }, async () => {
      if (dir) {
        writeFileSync(join(dir, "playwright.config.js"), `import { defineConfig } from "@playwright/test";\nexport default defineConfig({ testDir: "e2e", reporter: [["list"], ["journeysfirst/reporter"]] });\n`);
        await show(you, "The app address is left out", "The setup no longer has an address for the app, and it no longer starts one.");
      } else await show(you, "The app address is left out", setupLog);
    });

    await journey.step("Ask what is wrong.", { by: "you", caption: "You ask what is wrong." }, async () => {
      if (dir) doctor = run(dir, process.execPath, [binOf(dir), "doctor"]);
      else doctor = { status: 1, output: setupLog };
      await show(you, "What is wrong", doctor.output);
    });

    await journey.check("missing-address", { by: "you", caption: "Checking that you see what to fix." }, async () => {
      const sawGap = /no baseURL and no webServer/.test(doctor.output);
      const sawFix = /Set use\.baseURL/.test(doctor.output);
      const passed = sawGap && sawFix;
      await show(you, "What to fix", doctor.output);
      return { passed, proof: "Asked what is wrong and read the reply.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "you", saw: passed ? "the app address is missing, and what to put there" : "no clear fix" }], reason: "The setup check did not say the app address is missing, or did not say what to put there.", caption: passed ? "you see what to put for the app address." : "you do not see a clear fix." };
    });

    await journey.check("teammate-no-false-pass", { by: "teammate", caption: "Checking that the broken setup is not called a pass." }, async () => {
      const calledPass = /All \d+ checks passed|result: passed/i.test(doctor.output);
      const passed = /NO/.test(doctor.output) && !calledPass;
      await show(teammate, "The broken setup", doctor.output);
      return { passed, proof: "Showed the teammate the reply for the broken setup.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "teammate", saw: passed ? "the broken setup is not a pass" : "the broken setup was not marked failed" }], reason: "The teammate could not tell that the broken setup failed.", caption: passed ? "the teammate does not see a false pass." : "the broken setup was not clearly failed." };
    });
  } finally {
    markTime(`start-from-an-empty-project ${broken ? "fail" : "pass"}`, Date.now() - started);
  }
});
