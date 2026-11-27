import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "journeysfirst/playwright";
import { REPO, binOf, freePort, install, markTime, newestRun, packs, playwrightOf, run, show } from "./support.js";

const broken = process.env.JF_BROKEN === "main";

test.journey("journeys/start-from-an-empty-project.journey.yaml", { measure: false }, async ({ journey }) => {
  test.setTimeout(240_000);
  const started = Date.now();
  try {
    const you = await journey.page("you");
    const teammate = await journey.page("teammate");
    const seen = newcomerPages();
    const tarball = broken ? packs().mainTgz : packs().branchTgz;

    await journey.step("Read the page.", { by: "you", caption: "You read the page." }, async () => {
      await show(you, "The page a newcomer sees", seen.text);
      await show(teammate, "The page a newcomer sees", seen.text);
    });

    await journey.check("what-it-is", { by: "you", caption: "Checking that you see what it is." }, async () => {
      const passed = seen.what;
      await show(you, "What it is", seen.whatText);
      return { passed, proof: "Read the opening a newcomer sees.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "you", saw: passed ? "what Journeys First is" : "no plain description" }], reason: "The page a newcomer sees does not say what Journeys First is.", caption: passed ? "you see what it is." : "you do not see what it is." };
    });

    await journey.check("who-it-is-for", { by: "you", caption: "Checking that you see who it is for." }, async () => {
      const passed = seen.who;
      await show(you, "Who it is for", seen.whoText);
      return { passed, proof: "Read who the opening says it is for.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "you", saw: passed ? "who it is for" : "no one named" }], reason: "The page a newcomer sees does not say who it is for.", caption: passed ? "you see who it is for." : "you do not see who it is for." };
    });

    await journey.check("how-to-start", { by: "you", caption: "Checking that you see how to get started." }, async () => {
      const passed = seen.how;
      await show(you, "How to get started", seen.howText);
      return { passed, proof: "Read the install steps on the README and the package page.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "you", saw: passed ? "how to get started" : "no way to get started" }], reason: "The page a newcomer sees does not show how to get started.", caption: passed ? "you see how to get started." : "you do not see how to get started." };
    });

    await journey.check("teammate-sees-how-to-start", { by: "teammate", caption: "Checking that the teammate sees how to get started." }, async () => {
      const passed = seen.how;
      await show(teammate, "How to get started", seen.howText);
      return { passed, proof: "Showed the teammate the same install steps.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "teammate", saw: passed ? "the same way to get started" : "no way to get started" }], reason: "The teammate did not see how to get started.", caption: passed ? "the teammate sees how to get started." : "the teammate does not see how to get started." };
    });

    await journey.check("teammate-sees-the-same-product", { by: "teammate", caption: "Checking that the teammate sees the same product." }, async () => {
      const passed = seen.sameProduct;
      await show(teammate, "The same product", seen.whatText);
      return { passed, proof: "Showed the teammate the same page.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "teammate", saw: passed ? "Journeys First" : "a different product" }], reason: "The teammate did not see Journeys First.", caption: passed ? "the teammate sees Journeys First." : "the teammate does not see Journeys First." };
    });
    let dir = "";
    let setupLog = "";

    await journey.step("Install it.", { by: "you", caption: "You install it." }, async () => {
      try {
        dir = install(tarball);
        setupLog = run(dir, process.execPath, [binOf(dir), "init"]).output;
      } catch (error) {
        setupLog = /** @type {Error} */ (error).message;
      }
      await show(you, "You install it and set the project up", setupLog);
    });

    await journey.check("approves-agent-instructions", { by: "you" }, async () => {
      const file = join(dir, "AGENTS.md");
      const proposed = /Proposed addition to AGENTS.md \(not written\)/.test(setupLog) && /write or update its journey/.test(setupLog);
      const untouched = Boolean(dir) && !existsSync(file);
      const approved = dir ? run(dir, process.execPath, [binOf(dir), "init", "--agent-instructions"]) : null;
      const written = approved?.status === 0 && existsSync(file) && /<!-- journeysfirst:start -->/.test(readFileSync(file, "utf8"));
      const passed = proposed && untouched && written;
      await show(you, "Approve the proposed agent instructions", `${setupLog}\nAGENTS.md absent before approval: ${untouched}\n${approved?.output ?? ""}`);
      return { passed, proof: "Read the proposal and checked the file before and after approval.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "you", saw: passed ? "Init previewed the section and wrote it only after approval." : "The proposal or approval did not work." }], reason: "Init did not preview the section and wait for approval before writing it." };
    });

    let first = { status: 1, output: "" };
    await journey.step("Try the sample it gives you.", { by: "you", caption: "You try the sample." }, async () => {
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
    await journey.step("Leave out where the app lives.", { by: "you", caption: "You leave out where the app lives." }, async () => {
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

/** What a newcomer can read before installing: the README, the package page, and the overview. */
function newcomerPages() {
  const readme = readFileSync(join(REPO, "README.md"), "utf8");
  const pack = readFileSync(join(REPO, "packages/core/README.md"), "utf8");
  const overview = readFileSync(join(REPO, "docs/overview.md"), "utf8");
  const opening = section(readme, "# Journeys First", "## The problem");
  const how = /## Install/.test(readme) && /npm install --save-dev journeysfirst/.test(readme) && /npx journeysfirst init/.test(readme) && /## Install/.test(pack) && /npx journeysfirst init/.test(pack);
  const howText = `${section(readme, "## Install", "## Use it")}\n\nPackage page:\n${section(pack, "## Install", "## The smallest example")}`;
  return {
    what: saysWhatThisIs(opening),
    who: saysWhoItIsFor(opening),
    how,
    sameProduct: /Journeys First/.test(readme) && /Journeys First/.test(pack) && /Journeys First/.test(overview),
    whatText: opening,
    whoText: opening,
    howText,
    text: `${opening}\n\n${howText}`,
  };
}

/**
 * The opening names the product and says it is a format for journeys written in plain sentences.
 * @param {string} opening
 */
function saysWhatThisIs(opening) {
  return /Journeys First/.test(opening) && /\bformat\b/i.test(opening) && /\bjourneys\b/i.test(opening) && /plain sentences/i.test(opening);
}

/**
 * The opening names your agent and the people it checks as. "user journeys" is the product, not the audience.
 * @param {string} opening
 */
function saysWhoItIsFor(opening) {
  const audience = opening.replace(/user journeys/gi, "journeys");
  return /\bagents?\b/i.test(audience) && /\b(human|person|people|users?)\b/i.test(audience);
}

/** @param {string} text @param {string} from @param {string} to */
function section(text, from, to) {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  if (start < 0) return "";
  return text.slice(start, end < 0 ? start + 500 : end).trim();
}
