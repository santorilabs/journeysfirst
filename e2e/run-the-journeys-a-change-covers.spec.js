import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "journeysfirst/playwright";
import { REPO, binOf, linkProject, markTime, newestRun, playwrightOf, run, show } from "./support.js";

const broken = process.env.JF_BROKEN === "selection";

test.journey("journeys/run-the-journeys-a-change-covers.journey.yaml", { video: true, pause: 0, measure: false }, async ({ journey }) => {
  test.setTimeout(180_000);
  const started = Date.now();
  try {
    const you = await journey.page("you");
    const reviewer = await journey.page("reviewer");
    const reader = await journey.page("reader");
    const dir = linkProject(join(REPO, "packages/core"));
    writeFixture(dir);

    await journey.step("Change the page a visitor opens. Leave the notes alone.", { by: "you", caption: "You change the page a visitor opens." }, async () => {
      writeFileSync(join(dir, "demo/index.html"), "<h1>Welcome</h1>\n");
      await show(you, "You change the page", "Changed demo/index.html. Left notes/readme.md alone.");
    });

    let output = "";
    /** @type {string[]} */
    let chosen = [];
    await journey.step("Try again every journey that covers that page.", { by: "you", caption: "You try again every journey that covers that page." }, async () => {
      if (broken) {
        output = "run journeys/open-the-page.journey.yaml\nrun journeys/read-the-notes.journey.yaml\n";
        chosen = ["Open the page", "Read the notes"];
      } else {
        const listed = run(dir, process.execPath, [binOf(dir), "affected", "demo/index.html"]);
        output = listed.output;
        chosen = [...output.matchAll(/^run journeys\/(.+)\.journey\.yaml$/gm)].map((match) => titleFor(match[1]));
      }
      for (const title of chosen) {
        const played = run(dir, process.execPath, [playwrightOf(dir), "test", "--grep", title]);
        output += `\n${played.output}`;
      }
      await show(you, "Which journeys ran", output);
    });

    const pageRun = newestRun(dir, "open-the-page");
    const notesRun = newestRun(dir, "read-the-notes");
    const pagePassed = Boolean(pageRun);
    const notesRan = Boolean(notesRun);
    const report = pageRun ? run(dir, process.execPath, [binOf(dir), "summary", pageRun]).output : output;

    await journey.check("covered-journey-runs", { by: "you", caption: "Checking that the page journey ran." }, async () => {
      const passed = pagePassed && /run journeys\/open-the-page\.journey\.yaml/.test(output);
      await show(you, "The page journey", passed ? "The journey that covers the page ran again." : output);
      return { passed, proof: "Ran the journeys the change selected and looked for the page journey.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "you", saw: passed ? "the page journey ran" : "the page journey did not run" }], reason: "The journey that covers the page did not run.", caption: passed ? "the page journey ran." : "the page journey did not run." };
    });

    await journey.check("other-journey-stays", { by: "you", caption: "Checking that the notes journey stayed." }, async () => {
      const passed = !notesRan && /skip journeys\/read-the-notes\.journey\.yaml/.test(output);
      await show(you, "The notes journey", passed ? "The notes journey did not run." : "The notes journey ran.");
      return { passed, proof: "Looked for a run of the notes journey.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "you", saw: passed ? "the notes journey did not run" : "the notes journey ran" }], reason: "The notes journey ran.", caption: passed ? "the notes journey did not run." : "the notes journey ran." };
    });

    await journey.check("you-see-which-ran", { by: "you", caption: "Checking that you can see the choice." }, async () => {
      const passed = /run journeys\/open-the-page\.journey\.yaml/.test(output) && /skip journeys\/read-the-notes\.journey\.yaml/.test(output);
      await show(you, "Which journeys ran", output);
      return { passed, proof: "Read the lines that say run or skip.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "you", saw: passed ? "which journeys ran and which did not" : "the choice was not listed" }], reason: "The run did not say which journeys ran and which did not.", caption: passed ? "you see which journeys ran." : "you cannot see which journeys ran." };
    });

    await journey.check("reviewer-sees-the-choice", { by: "reviewer", caption: "Checking what the reviewer sees." }, async () => {
      const passed = /run journeys\/open-the-page\.journey\.yaml/.test(output) && /skip journeys\/read-the-notes\.journey\.yaml/.test(output);
      await show(reviewer, "What the reviewer sees", output);
      return { passed, proof: "Showed the reviewer the same lines.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "reviewer", saw: passed ? "which journey ran and which did not" : "the choice was not listed" }], reason: "The reviewer could not see which journey ran.", caption: passed ? "the reviewer sees the choice." : "the reviewer does not see the choice." };
    });

    await journey.check("reader-sees-the-report", { by: "reader", caption: "Checking the report." }, async () => {
      const text = `${output}\n\n${report}`;
      const passed = /run journeys\/open-the-page\.journey\.yaml/.test(text) && /skip journeys\/read-the-notes\.journey\.yaml/.test(text) && /passed/i.test(report);
      await show(reader, "The report", text);
      return { passed, proof: "Showed the reader the choice and the report of the page journey.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "reader", saw: passed ? "the same choice in the report" : "the report did not show the choice" }], reason: "The reader did not see which journeys ran.", caption: passed ? "the reader sees the choice." : "the reader does not see the choice." };
    });

    await journey.check("reader-does-not-see-a-false-run", { by: "reader", caption: "Checking that the notes journey is not listed as run." }, async () => {
      const passed = !/run journeys\/read-the-notes\.journey\.yaml/.test(output);
      await show(reader, "The notes journey is not listed as run", output);
      return { passed, proof: "Read the report for a run line for the notes journey.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "reader", saw: passed ? "the notes journey is not listed as run" : "the notes journey is listed as run" }], reason: "The reader saw the notes journey listed as run.", caption: passed ? "the notes journey is not listed as run." : "the notes journey is listed as run." };
    });
  } finally {
    markTime(`run-the-journeys-a-change-covers ${broken ? "fail" : "pass"}`, Date.now() - started);
  }
});

/** @param {string} name */
function titleFor(name) {
  if (name === "open-the-page") return "Open the page";
  if (name === "read-the-notes") return "Read the notes";
  return name;
}

/** @param {string} dir */
function writeFixture(dir) {
  mkdirSync(join(dir, "journeys"), { recursive: true });
  mkdirSync(join(dir, "e2e"), { recursive: true });
  mkdirSync(join(dir, "demo"), { recursive: true });
  mkdirSync(join(dir, "notes"), { recursive: true });
  writeFileSync(join(dir, "notes/readme.md"), "Notes\n");
  writeFileSync(join(dir, "demo/index.html"), "<h1>Old</h1>\n");
  writeFileSync(join(dir, "journeys/covered-by.yaml"), "open-the-page:\n  - demo/**\nread-the-notes:\n  - notes/**\n");
  writeFileSync(join(dir, "journeys/open-the-page.journey.yaml"), "format: journeysfirst/v1\ntitle: Open the page\npromise: I want to open the page and see \"Welcome\".\nstart: The page says \"Welcome\".\nsteps:\n  - Open the page.\n  - check: You see \"Welcome\".\n    id: sees-welcome\n");
  writeFileSync(join(dir, "journeys/read-the-notes.journey.yaml"), "format: journeysfirst/v1\ntitle: Read the notes\npromise: I want to open the notes and see \"Notes\".\nstart: The notes say \"Notes\".\nsteps:\n  - Open the notes.\n  - check: You see \"Notes\".\n    id: sees-notes\n");
  writeFileSync(join(dir, "e2e/open-the-page.spec.js"), innerSpec("journeys/open-the-page.journey.yaml", "Open the page.", "Welcome", "sees-welcome"));
  writeFileSync(join(dir, "e2e/read-the-notes.spec.js"), innerSpec("journeys/read-the-notes.journey.yaml", "Open the notes.", "Notes", "sees-notes"));
  writeFileSync(join(dir, "playwright.config.js"), `import { defineConfig } from "@playwright/test";\nexport default defineConfig({\n  testDir: "e2e",\n  reporter: [["list"], ["journeysfirst/reporter", { outputDir: "journey-runs" }]],\n  use: { baseURL: "http://127.0.0.1:9", trace: "off" },\n});\n`);
  if (!existsSync(join(dir, "node_modules/journeysfirst"))) throw new Error("link missing");
}

/** @param {string} file @param {string} step @param {string} word @param {string} id */
function innerSpec(file, step, word, id) {
  return `import { test } from "journeysfirst/playwright";
test.journey(${JSON.stringify(file)}, { video: false, measure: false }, async ({ journey }) => {
  const page = await journey.page("you");
  await journey.step(${JSON.stringify(step)}, { by: "you" }, async () => {
    await page.setContent("<h1>${word}</h1>");
  });
  await journey.check(${JSON.stringify(id)}, { by: "you" }, async () => {
    const text = await page.locator("h1").textContent();
    return { passed: text === ${JSON.stringify(word)}, proof: "Read the heading.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "you", saw: text ?? "nothing" }], reason: "The heading was wrong." };
  });
});
`;
}
