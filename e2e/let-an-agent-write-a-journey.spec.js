import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "journeysfirst/playwright";
import { REPO, binOf, freePort, linkProject, markTime, newestRun, packs, playwrightOf, run, show } from "./support.js";

const broken = process.env.JF_BROKEN === "main";

test.journey("journeys/let-an-agent-write-a-journey.journey.yaml", { video: true, pause: 0, measure: false }, async ({ journey }) => {
  test.setTimeout(180_000);
  const started = Date.now();
  try {
    const you = await journey.page("you");
    const agent = await journey.page("agent");
    const reviewer = await journey.page("reviewer");
    const core = broken ? join(packs().mainTree, "packages/core") : join(REPO, "packages/core");
    const dir = linkProject(core);
    const init = run(dir, process.execPath, [binOf(dir), "init"]);
    const skills = skillFiles(dir);
    let format = "";
    for (const file of skills) {
      const match = readFileSync(file, "utf8").match(/journeysfirst\/v1/);
      if (match) {
        format = match[0];
        break;
      }
    }

    await journey.step("The agent finds the instructions.", { by: "agent", caption: "The agent finds the instructions." }, async () => {
      await show(agent, "The agent finds the instructions", skills.length ? skills.join("\n") : `No instructions found.\n${init.output}`);
    });

    await journey.step("The agent writes down one thing the page should do.", { by: "agent", caption: "The agent writes down one thing the page should do." }, async () => {
      mkdirSync(join(dir, "journeys"), { recursive: true });
      mkdirSync(join(dir, "e2e"), { recursive: true });
      writeFileSync(join(dir, "journeys/see-that-you-are-in.journey.yaml"), `format: ${format || "missing"}\ntitle: See that you are in\npromise: I want to open the page and see that I am in.\nstart: The example page is what the browser will open.\nsteps:\n  - Open the page and choose I am in.\n  - check: The page says you are in.\n    id: you-are-in\n`);
      writeFileSync(join(dir, "e2e/see-that-you-are-in.spec.js"), `import { test } from "journeysfirst/playwright";\ntest.journey("journeys/see-that-you-are-in.journey.yaml", { video: false, measure: false }, async ({ journey }) => {\n  const you = await journey.page("you", { account: "signed out" });\n  await journey.step("Open the page and choose I am in.", { by: "you" }, async () => {\n    await you.goto("/");\n    await you.getByRole("button", { name: "I am in" }).click();\n  });\n  await journey.check("you-are-in", { by: "you" }, async () => {\n    const text = await you.locator("#status").textContent();\n    return { passed: text === "You are in.", proof: "Read the status line.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "you", saw: text ?? "nothing" }], reason: "The page did not say you are in." };\n  });\n});\n`);
      await show(agent, "The agent writes a journey", readFileSync(join(dir, "journeys/see-that-you-are-in.journey.yaml"), "utf8"));
    });

    let played = { status: 1, output: "" };
    await journey.step("The agent tries that.", { by: "agent", caption: "The agent tries that." }, async () => {
      played = run(dir, process.execPath, [playwrightOf(dir), "test", "--grep", "See that you are in"], { JOURNEYS_PORT: freePort() });
      await show(agent, "The agent runs that journey", played.output);
    });

    const folder = newestRun(dir, "see-that-you-are-in");
    const runJson = folder ? JSON.parse(readFileSync(join(folder, "run.json"), "utf8")) : null;
    const lines = (runJson?.steps ?? []).map((step) => (step.says ? `${step.status}: ${step.says}` : `${step.verdict}: ${step.check}`)).join("\n");
    const every = Boolean(runJson) && runJson.result === "passed" && runJson.steps.length > 0 && runJson.steps.every((step) => step.status === "done" || step.verdict === "passed" || step.verdict === "failed");
    const secret = folder ? folderHasSecret(folder) : false;

    await journey.check("result-on-every-line", { by: "agent", caption: "Checking that every line has a result." }, async () => {
      await show(agent, "A result on every line", lines || played.output);
      return { passed: every, proof: "Read each line of the run.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "agent", saw: every ? lines : "no result on every line" }], reason: "The run did not show a result on every line.", caption: every ? "every line has a result." : "a line has no result." };
    });

    await journey.check("agent-not-waiting", { by: "agent", caption: "Checking that the agent was not asked to wait." }, async () => {
      const waiting = /waiting for you|need a person to|ask the person/i.test(played.output + lines);
      const passed = !waiting;
      await show(agent, "No one asked the agent to wait", passed ? "The agent was not asked to wait." : played.output);
      return { passed, proof: "Read the run for a request to wait for a person.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "agent", saw: passed ? "no request to wait" : "a request to wait" }], reason: "The agent was asked to wait for a person.", caption: passed ? "the agent is not waiting." : "the agent was asked to wait." };
    });

    await journey.check("you-see-the-proof", { by: "you", caption: "Checking that you see the proof." }, async () => {
      const passed = every;
      await show(you, "The proof, without you stepping in", passed ? `You did none of the steps.\n\n${lines}` : played.output);
      return { passed, proof: "The agent ran the journey. You did not take a step.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "you", saw: passed ? "the proof, and you did none of the steps" : "no proof" }], reason: "There is no passing proof.", caption: passed ? "you see the proof." : "you do not see the proof." };
    });

    await journey.check("reviewer-sees-every-line", { by: "reviewer", caption: "Checking what the reviewer sees." }, async () => {
      await show(reviewer, "What the reviewer sees", lines || played.output);
      return { passed: every, proof: "Showed the reviewer each line of the run.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "reviewer", saw: every ? lines : "no result on every line" }], reason: "The reviewer did not see a result on every line.", caption: every ? "the reviewer sees every line." : "the reviewer does not see every line." };
    });

    await journey.check("reviewer-sees-no-secret", { by: "reviewer", caption: "Checking that the reviewer sees no secret." }, async () => {
      const passed = !secret;
      await show(reviewer, "No secret in the proof", passed ? `No secret in the run.\n\n${lines || played.output}` : "A secret was found in the run.");
      return { passed, proof: "Searched the run folder for a password, a key, or a bearer token.", evidence: [{ source: "page", url: "http://127.0.0.1:9/", login: "reviewer", saw: passed ? "no secret in the proof" : "a secret in the proof" }], reason: "The reviewer saw a secret in the proof.", caption: passed ? "the reviewer sees no secret." : "the reviewer sees a secret." };
    });
  } finally {
    markTime(`let-an-agent-write-a-journey ${broken ? "fail" : "pass"}`, Date.now() - started);
  }
});

/** @param {string} dir */
function skillFiles(dir) {
  /** @type {string[]} */
  const found = [];
  for (const root of [".agents/skills", ".claude/skills"]) {
    const base = join(dir, root);
    if (existsSync(base)) walk(base, found);
  }
  return found;
}

/** @param {string} dir @param {string[]} found */
function walk(dir, found) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (name === "SKILL.md") found.push(path);
  }
}

/** @param {string} folder */
function folderHasSecret(folder) {
  const pattern = /password\s*[:=]\s*["']?[^\s"']{4,}|api[_-]?key\s*[:=]\s*["']?[^\s"']{4,}|Bearer\s+\S{8,}/i;
  return walkBytes(folder).some((text) => pattern.test(text));
}

/** @param {string} dir */
function walkBytes(dir) {
  /** @type {string[]} */
  const texts = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) texts.push(...walkBytes(path));
    else if (statSync(path).size < 2_000_000) texts.push(readFileSync(path).toString("utf8"));
  }
  return texts;
}
