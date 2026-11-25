import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RETIRED_SKILLS, UPGRADE_WORKFLOW, init, journeysSection, nextSteps, packageSkills, upgrade, upgradeWorkflow } from "../src/setup.js";
import { VERSION } from "../src/shared/version.js";

const BIN = new URL("../bin/journeysfirst.js", import.meta.url).pathname;
const cli = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
const repo = () => mkdtempSync(join(tmpdir(), "jf-setup-"));
const read = (dir, file) => readFileSync(join(dir, file), "utf8");
const skill = (name) => readFileSync(new URL(`../../../skills/${name}/SKILL.md`, import.meta.url), "utf8");

test("init copies every package skill, adds a Playwright config and ignores journey-runs/", () => {
  const dir = repo();
  const changes = init({ root: dir });
  assert.deepEqual(readdirSync(join(dir, ".claude/skills")).sort(), packageSkills());
  for (const name of packageSkills()) assert.equal(read(dir, `.claude/skills/${name}/SKILL.md`), skill(name));
  assert.match(read(dir, "playwright.config.js"), /journeysfirst\/reporter/);
  assert.match(read(dir, "playwright.config.js"), /reuseExistingServer: false/);
  assert.match(read(dir, "playwright.config.js"), /trace: "retain-on-failure"/);
  assert.equal(read(dir, ".gitignore"), "journey-runs/\ntest-results/\n");
  assert.ok(changes.includes("added .claude/skills/journey-onboard"), changes.join("\n"));
  assert.ok(changes.some((c) => c.startsWith("added playwright.config.js")), changes.join("\n"));
  assert.ok(changes.includes("added journey-runs/ to .gitignore"), changes.join("\n"));
  assert.ok(changes.includes("added test-results/ to .gitignore"), changes.join("\n"));
});

test("the new Playwright config starts the app with its dev script, else its start script, else says what to set", () => {
  const withScripts = (/** @type {Record<string, string>} */ scripts) => {
    const dir = repo();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts }));
    return { dir, changes: init({ root: dir }) };
  };
  const dev = withScripts({ dev: "vite", start: "node server.js" });
  assert.match(read(dev.dir, "playwright.config.js"), /command: "npm run dev",/);
  assert.ok(dev.changes.includes("added playwright.config.js: webServer starts the app with npm run dev, on the port in JOURNEYS_PORT (4321 if unset). Check that the app listens on PORT"), dev.changes.join("\n"));
  assert.ok(!existsSync(join(dev.dir, "demo")), "a repo with a dev script does not get the example");
  const start = withScripts({ start: "node server.js" });
  assert.match(read(start.dir, "playwright.config.js"), /command: "npm start",/);
  assert.ok(start.changes.some((c) => c.startsWith("added playwright.config.js: webServer starts the app with npm start")), start.changes.join("\n"));
  assert.ok(!existsSync(join(start.dir, "demo")));
  const none = withScripts({ test: "node --test" });
  assert.match(read(none.dir, "playwright.config.js"), /command: "node demo\/serve\.mjs",/);
  assert.ok(none.changes.some((c) => c.startsWith("added playwright.config.js: webServer serves the example page in demo/")), none.changes.join("\n"));
  assert.ok(existsSync(join(none.dir, "demo/index.html")));
  assert.ok(existsSync(join(none.dir, "e2e/see-the-example.spec.js")));
  assert.match(read(none.dir, "journeys/see-the-example.journey.yaml"), /journeysfirst example/);
});

test("the new Playwright config takes the app's port from JOURNEYS_PORT, so two runs can share a repo", async () => {
  const dir = repo();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { start: "node server.js" } }));
  init({ root: dir });
  const load = (/** @type {string|undefined} */ port) =>
    spawnSync(process.execPath, ["--input-type=module", "-e", `const { default: c } = await import(${JSON.stringify(join(dir, "playwright.config.js"))}); console.log(JSON.stringify(c));`], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: "", ...(port ? { JOURNEYS_PORT: port } : {}) },
    });
  // The config imports @playwright/test, which a bare temp folder lacks, so link this repo's node_modules.
  symlinkSync(new URL("../../../node_modules", import.meta.url).pathname, join(dir, "node_modules"));
  const plain = JSON.parse(load(undefined).stdout);
  assert.equal(plain.use.baseURL, "http://localhost:4321");
  assert.deepEqual(plain.webServer.env, { PORT: "4321" });
  const other = JSON.parse(load("4322").stdout);
  assert.equal(other.use.baseURL, "http://localhost:4322");
  assert.equal(other.webServer.url, "http://localhost:4322");
  assert.deepEqual(other.webServer.env, { PORT: "4322" });
  assert.notEqual(other.outputDir, plain.outputDir, "each port has its own test-results folder");
});

test("with no app and an existing script, the new config sets neither baseURL nor webServer and says what to set", () => {
  const dir = repo();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  mkdirSync(join(dir, "e2e"));
  writeFileSync(join(dir, "e2e/own.spec.js"), "the product's script\n");
  const changes = init({ root: dir });
  const config = read(dir, "playwright.config.js");
  assert.doesNotMatch(config, /\bwebServer\s*:/);
  assert.doesNotMatch(config, /\bbaseURL\s*:/);
  assert.match(config, /npx journeysfirst init --demo/);
  assert.ok(!existsSync(join(dir, "demo")));
  assert.ok(changes.some((c) => c.includes("This run has no baseURL and no webServer.") && c.includes("npx journeysfirst init --demo")), changes.join("\n"));
});

test("init --demo adds the example even when the repo has a start script, and skips it when a config is already there", () => {
  const dir = repo();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { start: "node server.js" } }));
  const added = init({ root: dir, demo: true });
  assert.match(read(dir, "playwright.config.js"), /command: "node demo\/serve\.mjs",/);
  assert.ok(added.includes("added journeys/see-the-example.journey.yaml"), added.join("\n"));
  assert.ok(added.some((c) => c.startsWith("added playwright.config.js: webServer serves the example page")), added.join("\n"));
  const taken = repo();
  writeFileSync(join(taken, "playwright.config.js"), "export default { use: { baseURL: \"http://127.0.0.1:3000\" }, webServer: { command: \"npm start\" } };\n");
  const skipped = init({ root: taken, demo: true });
  assert.ok(!existsSync(join(taken, "demo")));
  assert.ok(skipped.some((c) => c.includes("--demo did not add the example")), skipped.join("\n"));
});

test("the example from init does not count as the product's own journeys, so the next steps still install the browser", () => {
  const dir = repo();
  init({ root: dir });
  const steps = nextSteps("init", { root: dir }).join("\n");
  assert.match(steps, /npx playwright install --only-shell chromium/);
  assert.match(steps, /journey-onboard/);
  const upgraded = nextSteps("upgrade", { root: dir }).join("\n");
  assert.match(upgraded, /journey-onboard/);
  assert.doesNotMatch(upgraded, /Run the journeys again/);
});

test("init keeps an existing Playwright config and .gitignore lines, and says when the config lacks the reporter", () => {
  const dir = repo();
  writeFileSync(join(dir, "playwright.config.ts"), "export default {};\n");
  writeFileSync(join(dir, ".gitignore"), "node_modules/");
  const changes = init({ root: dir, skillsDir: ".agents/skills" });
  assert.ok(existsSync(join(dir, ".agents/skills/journey-run/SKILL.md")));
  assert.ok(!existsSync(join(dir, "playwright.config.js")));
  assert.equal(read(dir, "playwright.config.ts"), "export default {};\n");
  assert.ok(changes.some((c) => c.startsWith("kept playwright.config.ts") && c.includes("journeysfirst/reporter")), changes.join("\n"));
  assert.ok(changes.some((c) => c.startsWith("kept playwright.config.ts. This run has no baseURL and no webServer.")), changes.join("\n"));
  assert.ok(changes.some((c) => c.includes("npx journeysfirst init --demo")), changes.join("\n"));
  assert.equal(read(dir, ".gitignore"), "node_modules/\njourney-runs/\ntest-results/\n");
});

test("upgrade adds trace: retain-on-failure to a config's use, and never changes a trace setting the repo has", () => {
  const dir = repo();
  init({ root: dir });
  const config = `import { defineConfig } from "@playwright/test";\nexport default defineConfig({\n  reporter: [["journeysfirst/reporter"]],\n  use: {\n    baseURL: "http://localhost:3000",\n  },\n});\n`;
  writeFileSync(join(dir, "playwright.config.js"), config);
  assert.ok(upgrade({ root: dir }).includes(`added trace: "retain-on-failure" to use in playwright.config.js: a failed run keeps Playwright's trace`));
  assert.equal(read(dir, "playwright.config.js"), config.replace("use: {", `use: { trace: "retain-on-failure",`));
  assert.ok(!upgrade({ root: dir }).some((c) => c.includes("trace")), "a second upgrade changes nothing");

  const theirs = config.replace("use: {", `use: { trace: "on-first-retry",`);
  writeFileSync(join(dir, "playwright.config.js"), theirs);
  upgrade({ root: dir });
  assert.equal(read(dir, "playwright.config.js"), theirs, "their own trace setting stays");

  const noUse = `export default { reporter: [["journeysfirst/reporter"]] };\n`;
  writeFileSync(join(dir, "playwright.config.js"), noUse);
  assert.ok(upgrade({ root: dir }).includes(`kept playwright.config.js. A failed run keeps no Playwright trace: add trace: "retain-on-failure" to use`));
  assert.equal(read(dir, "playwright.config.js"), noUse);
});

test("init adds the upgrade workflow, and upgrade rewrites an old copy of it", () => {
  const dir = repo();
  const added = init({ root: dir });
  assert.equal(read(dir, UPGRADE_WORKFLOW), readFileSync(new URL("../templates/journeysfirst-upgrade.yml", import.meta.url), "utf8"));
  assert.match(read(dir, UPGRADE_WORKFLOW), /types: \[journeysfirst-release\]/);
  assert.ok(added.some((c) => c.startsWith(`added ${UPGRADE_WORKFLOW}`)), added.join("\n"));
  assert.ok(!upgrade({ root: dir }).some((c) => c.includes(UPGRADE_WORKFLOW)), "an up-to-date workflow is left alone");
  writeFileSync(join(dir, UPGRADE_WORKFLOW), "an older copy\n");
  assert.ok(upgrade({ root: dir }).includes(`updated ${UPGRADE_WORKFLOW}`));
  assert.equal(read(dir, UPGRADE_WORKFLOW), upgradeWorkflow(".claude/skills"));
});

test("the upgrade workflow passes --skills when the skills are not in .claude/skills", () => {
  const dir = repo();
  init({ root: dir, skillsDir: ".agents/skills" });
  assert.match(read(dir, UPGRADE_WORKFLOW), /\$run journeysfirst upgrade --skills \.agents\/skills \|/);
  assert.match(upgradeWorkflow(".claude/skills"), /\$run journeysfirst upgrade \|/);
});

test("init refuses a repo that already has the skills, and points to upgrade", () => {
  const dir = repo();
  init({ root: dir });
  assert.throws(() => init({ root: dir }), /npx journeysfirst upgrade/);
});

test("upgrade refreshes the package skills, deletes retired ones, and never touches the app skill", () => {
  const dir = repo();
  init({ root: dir });
  const skills = join(dir, ".claude/skills");
  writeFileSync(join(skills, "journey-run/SKILL.md"), "an older copy\n");
  mkdirSync(join(skills, RETIRED_SKILLS[0]));
  writeFileSync(join(skills, RETIRED_SKILLS[0], "SKILL.md"), "retired\n");
  mkdirSync(join(skills, "acme-journeys"));
  writeFileSync(join(skills, "acme-journeys/SKILL.md"), "the app skill\n");
  const changes = upgrade({ root: dir });
  assert.equal(read(dir, ".claude/skills/journey-run/SKILL.md"), skill("journey-run"));
  assert.ok(!existsSync(join(skills, RETIRED_SKILLS[0])));
  assert.equal(read(dir, ".claude/skills/acme-journeys/SKILL.md"), "the app skill\n");
  assert.ok(changes.some((c) => c.startsWith("updated .claude/skills/journey-run")), changes.join("\n"));
  assert.ok(changes.includes(`removed .claude/skills/${RETIRED_SKILLS[0]} (this version no longer ships it)`), changes.join("\n"));
  assert.ok(!changes.some((c) => c.includes("acme-journeys")), changes.join("\n"));
  assert.ok(!changes.some((c) => c.includes(".gitignore")), "the ignore line was already there");
});

test("upgrade on a repo set up by an older version, with only its skills, adds the new ones", () => {
  const dir = repo();
  mkdirSync(join(dir, ".claude/skills/journey-write"), { recursive: true });
  writeFileSync(join(dir, ".claude/skills/journey-write/SKILL.md"), skill("journey-write"));
  const changes = upgrade({ root: dir });
  assert.ok(changes.includes("added .claude/skills/journey-onboard"), changes.join("\n"));
  assert.ok(changes.includes("unchanged .claude/skills/journey-write"), changes.join("\n"));
});

test("upgrade on a repo with the skills under their old names deletes them and writes the new ones", () => {
  const dir = repo();
  const old = { onboard: "journey-onboard", "write-journey": "journey-write", "run-journey": "journey-run", "fix-journey-run": "journey-fix" };
  for (const name of Object.keys(old)) {
    mkdirSync(join(dir, ".claude/skills", name), { recursive: true });
    writeFileSync(join(dir, ".claude/skills", name, "SKILL.md"), "an older copy\n");
  }
  const changes = upgrade({ root: dir });
  for (const [name, renamed] of Object.entries(old)) {
    assert.ok(!existsSync(join(dir, ".claude/skills", name)), `${name} is gone`);
    assert.ok(changes.includes(`removed .claude/skills/${name} (this version no longer ships it)`), changes.join("\n"));
    assert.equal(read(dir, `.claude/skills/${renamed}/SKILL.md`), skill(renamed));
  }
  assert.deepEqual(readdirSync(join(dir, ".claude/skills")).sort(), packageSkills());
});

test("upgrade writes through linked skill folders, the layout npx skills add makes", () => {
  const dir = repo();
  mkdirSync(join(dir, ".claude/skills"), { recursive: true });
  for (const name of packageSkills()) {
    mkdirSync(join(dir, ".agents/skills", name), { recursive: true });
    writeFileSync(join(dir, ".agents/skills", name, "SKILL.md"), "an older copy\n");
    symlinkSync(join("../../.agents/skills", name), join(dir, ".claude/skills", name));
  }
  const changes = upgrade({ root: dir });
  for (const name of packageSkills()) {
    assert.ok(lstatSync(join(dir, ".claude/skills", name)).isSymbolicLink(), `${name} is still a link`);
    assert.equal(read(dir, `.agents/skills/${name}/SKILL.md`), skill(name));
  }
  assert.ok(changes.some((c) => c.startsWith("updated .claude/skills/journey-onboard")), changes.join("\n"));
  assert.ok(changes.includes("added AGENTS.md"), changes.join("\n"));
});

test("upgrade on a repo that only has .agents/skills also fills .claude/skills", () => {
  const dir = repo();
  mkdirSync(join(dir, ".agents/skills/journey-write"), { recursive: true });
  writeFileSync(join(dir, ".agents/skills/journey-write/SKILL.md"), "an older copy\n");
  const changes = upgrade({ root: dir });
  assert.equal(read(dir, ".agents/skills/journey-write/SKILL.md"), skill("journey-write"));
  assert.equal(read(dir, ".claude/skills/journey-write/SKILL.md"), skill("journey-write"));
  assert.ok(changes.includes("added .agents/skills/journey-onboard"), changes.join("\n"));
  assert.ok(changes.includes("added .claude/skills/journey-onboard"), changes.join("\n"));
  assert.match(read(dir, "AGENTS.md"), /\.claude\/skills\/journey-run\/SKILL\.md/);
  assert.match(read(dir, UPGRADE_WORKFLOW), /\$run journeysfirst upgrade \|/);
  assert.doesNotMatch(read(dir, UPGRADE_WORKFLOW), /--skills/);
  assert.match(nextSteps("upgrade", { root: dir }).join("\n"), /\.claude\/skills\/journey-onboard\/SKILL\.md/);
});

test("init copies the skills into .agents/skills and .claude/skills, and --skills copies to one folder", () => {
  const dir = repo();
  const changes = init({ root: dir });
  assert.deepEqual(readdirSync(join(dir, ".agents/skills")).sort(), packageSkills());
  assert.deepEqual(readdirSync(join(dir, ".claude/skills")).sort(), packageSkills());
  for (const name of packageSkills()) assert.equal(read(dir, `.agents/skills/${name}/SKILL.md`), skill(name));
  assert.ok(changes.includes("added .agents/skills/journey-onboard"), changes.join("\n"));
  assert.ok(changes.includes("added .claude/skills/journey-onboard"), changes.join("\n"));
  const one = repo();
  init({ root: one, skillsDir: ".claude/skills" });
  assert.ok(existsSync(join(one, ".claude/skills/journey-run/SKILL.md")));
  assert.ok(!existsSync(join(one, ".agents")));
  const agents = repo();
  mkdirSync(join(agents, ".agents/skills/journey-run"), { recursive: true });
  writeFileSync(join(agents, ".agents/skills/journey-run/SKILL.md"), "already\n");
  assert.throws(() => init({ root: agents }), /\.agents\/skills already has journey-run[\s\S]*npx journeysfirst upgrade/);
});

test("CLI --help exits 0 and accepts --flag=value syntax", () => {
  const dir = repo();
  for (const arg of ["--help", "-h", "help"]) {
    const res = cli([arg], dir);
    assert.equal(res.status, 0, `${arg}: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /^Usage:/);
    assert.match(res.stdout, /Skills go to \.agents\/skills and \.claude\/skills/);
  }
  const eqInit = cli(["init", "--skills=.agents/skills"], dir);
  assert.equal(eqInit.status, 0, eqInit.stdout + eqInit.stderr);
  assert.ok(existsSync(join(dir, ".agents/skills/journey-onboard/SKILL.md")));
});

test("upgrade refuses a repo with no Journeys First skills, and points to init", () => {
  assert.throws(() => upgrade({ root: repo() }), /npx journeysfirst init/);
});

test("terminal init and upgrade keep skills without browser setup, even with a dev script", () => {
  const dir = repo();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { dev: "convex dev" } }));
  const result = cli(["init", "--terminal", "--skills", ".agents/skills"], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(dir, ".agents/skills/journey-run/SKILL.md")));
  const refreshed = cli(["upgrade", "--skills", ".agents/skills"], dir);
  assert.equal(refreshed.status, 0, refreshed.stderr);
  for (const { stdout } of [result, refreshed]) assert.doesNotMatch(stdout, /playwright|Chromium|webServer/i);
  assert.ok(!existsSync(join(dir, "playwright.config.js")));
  assert.ok(!existsSync(join(dir, "demo")));
});

test("browser setup only recommends installing the headless shell when its revision is missing", () => {
  const dir = repo();
  const dependency = join(dir, "node_modules", "@playwright", "test");
  const cache = join(dir, "browsers", "chromium_headless_shell-1234");
  mkdirSync(dependency, { recursive: true });
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(dependency, "package.json"), "{}");
  writeFileSync(join(dependency, "cli.js"), `
    if (process.argv.slice(2).join(" ") !== "install --dry-run --only-shell chromium") process.exit(1);
    console.log("  Install location:    " + ${JSON.stringify(cache)});
  `);
  assert.match(nextSteps("init", { root: dir }).join("\n"), /playwright install --only-shell chromium/);
  writeFileSync(join(cache, "INSTALLATION_COMPLETE"), "");
  assert.doesNotMatch(nextSteps("init", { root: dir }).join("\n"), /playwright install --only-shell chromium/);
});

test("the CLI runs init and upgrade in the current folder, takes --skills, and prints each change", () => {
  const dir = repo();
  const first = cli(["init", "--skills", ".agents/skills"], dir);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, new RegExp(`^journeysfirst ${VERSION.replaceAll(".", "\\.")} init\n`));
  assert.match(first.stdout, /added \.agents\/skills\/journey-onboard/);
  const same = cli(["upgrade", "--skills", ".agents/skills"], dir);
  assert.equal(same.status, 0, same.stdout + same.stderr);
  assert.match(same.stdout, /unchanged \.agents\/skills\/journey-run\n/);
  assert.match(same.stdout, /Nothing changed\./);
  assert.match(same.stdout, /npx playwright install --only-shell chromium/);
  assert.equal(cli(["--version"], dir).stdout, `${VERSION}\n`);
  const refused = cli(["init", "--skills", ".agents/skills"], dir);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /npx journeysfirst upgrade/);
  const demo = repo();
  writeFileSync(join(demo, "package.json"), JSON.stringify({ scripts: { start: "node server.js" } }));
  const flagged = cli(["init", "--demo"], demo);
  assert.equal(flagged.status, 0, flagged.stdout + flagged.stderr);
  assert.match(flagged.stdout, /added demo\/index\.html/);
  assert.match(flagged.stdout, /node demo\/serve\.mjs|example page in demo/);
});

test("init adds the Journeys section to AGENTS.md, and never makes a CLAUDE.md", () => {
  const dir = repo();
  writeFileSync(join(dir, "AGENTS.md"), "# Working here\n");
  const changes = init({ root: dir });
  assert.equal(read(dir, "AGENTS.md"), `# Working here\n\n${journeysSection(".claude/skills")}`);
  assert.ok(!existsSync(join(dir, "CLAUDE.md")));
  assert.ok(changes.includes("added the Journeys section to AGENTS.md"), changes.join("\n"));
  assert.match(read(dir, "AGENTS.md"), /run the journeys it touches/);
  assert.match(read(dir, "AGENTS.md"), /`npx journeysfirst init` or `npx journeysfirst upgrade` wrote this section\. Each upgrade writes it again\./);
  assert.match(read(dir, "AGENTS.md"), /\.claude\/skills\/journey-run\/SKILL\.md/);
  assert.match(read(dir, "AGENTS.md"), /review each run with `\.claude\/skills\/journey-review\/SKILL\.md`\. The change is done when the run passed and the review found nothing, or a person has seen the findings\./);
  assert.match(read(dir, "AGENTS.md"), /never delete a finding/);
  const none = repo();
  assert.ok(init({ root: none, skillsDir: ".agents/skills" }).includes("added AGENTS.md"));
  assert.equal(read(none, "AGENTS.md"), journeysSection(".agents/skills"));
  assert.ok(!existsSync(join(none, "CLAUDE.md")));
});

test("a CLAUDE.md gets the section too, unless it imports AGENTS.md; a CLAUDE.md that is only @AGENTS.md is left as it is", () => {
  const own = repo();
  writeFileSync(join(own, "CLAUDE.md"), "c\n");
  mkdirSync(join(own, ".claude"));
  writeFileSync(join(own, ".claude/CLAUDE.md"), "see @AGENTS.md\n");
  init({ root: own });
  assert.equal(read(own, "AGENTS.md"), journeysSection(".claude/skills"));
  assert.ok(read(own, "CLAUDE.md").includes(journeysSection(".claude/skills")));
  assert.equal(read(own, ".claude/CLAUDE.md"), "see @AGENTS.md\n");
  const old = repo();
  init({ root: old });
  writeFileSync(join(old, "CLAUDE.md"), "@AGENTS.md\n");
  const changes = upgrade({ root: old });
  assert.equal(read(old, "CLAUDE.md"), "@AGENTS.md\n");
  assert.ok(changes.every((c) => c.startsWith("unchanged ")), changes.join("\n"));
});

test("upgrade rewrites only the Journeys section, keeps the rest of the file, and changes nothing when it is current", () => {
  const dir = repo();
  writeFileSync(join(dir, "AGENTS.md"), "top\n");
  init({ root: dir });
  writeFileSync(join(dir, "AGENTS.md"), read(dir, "AGENTS.md").replace("run the journeys it touches", "an old wording") + "bottom\n");
  const changes = upgrade({ root: dir });
  assert.equal(read(dir, "AGENTS.md"), `top\n\n${journeysSection(".claude/skills")}bottom\n`);
  assert.ok(changes.includes("updated the Journeys section in AGENTS.md"), changes.join("\n"));
  assert.ok(upgrade({ root: dir }).every((c) => c.startsWith("unchanged ")));
});

test("after init or upgrade, a repo with no journeys/README.md goes to journey-onboard; upgrade also re-checks scripts and re-runs", () => {
  const dir = repo();
  mkdirSync(join(dir, "e2e"));
  writeFileSync(join(dir, "e2e/share.spec.js"), "");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ devDependencies: { "@playwright/test": "^1.50.0" } }));
  assert.match(nextSteps("init", { root: dir }).join("\n"), /No journeys\/README\.md yet: follow \.claude\/skills\/journey-onboard\/SKILL\.md/);
  const upgraded = nextSteps("upgrade", { root: dir }).join("\n");
  assert.match(upgraded, /saved script in e2e\/ against the evidence rules/);
  assert.match(upgraded, /Run the journeys again/);
  assert.match(upgraded, /follow \.claude\/skills\/journey-onboard/);
  assert.doesNotMatch(upgraded, /npm install|playwright install/, "Playwright is there, and so are journeys");
  mkdirSync(join(dir, "journeys"));
  writeFileSync(join(dir, "journeys/README.md"), "# Journeys\n");
  const noFoundation = nextSteps("upgrade", { root: dir });
  assert.match(noFoundation.join("\n"), /journeys\/README\.md has no Foundation section\. Add it before you run the journeys: follow "Find the foundation" in \.claude\/skills\/journey-onboard\/SKILL\.md\./);
  assert.ok(noFoundation.findIndex((s) => s.includes("no Foundation")) < noFoundation.findIndex((s) => s.includes("Run the journeys again")), "the Foundation comes before the rerun, which reviews against it");
  writeFileSync(join(dir, "journeys/README.md"), "# Journeys\n\n## Foundation\n");
  assert.ok(!nextSteps("upgrade", { root: dir }).join("\n").includes("journey-onboard"));
  assert.match(nextSteps("init", { root: dir }).join("\n"), /journey-write/);
});

test("on a first install (no journeys, no e2e/ scripts), the next steps install Playwright and its browser and onboard, with nothing to re-run", () => {
  const dir = repo();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { start: "node server.js" }, devDependencies: { journeysfirst: "^0.0.1" } }));
  for (const command of /** @type {const} */ (["init", "upgrade"])) {
    assert.deepEqual(nextSteps(command, { root: dir }), [
      "Install Playwright, which runs the journeys: npm install --save-dev @playwright/test",
      "Install the browser the journeys use: npx playwright install --only-shell chromium",
      "No journeys/README.md yet: follow .claude/skills/journey-onboard/SKILL.md.",
    ]);
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify({ devDependencies: { journeysfirst: "^0.0.1", "@playwright/test": "^1.50.0" } }));
  assert.deepEqual(nextSteps("upgrade", { root: dir }), [
    "Install the browser the journeys use: npx playwright install --only-shell chromium",
    "No journeys/README.md yet: follow .claude/skills/journey-onboard/SKILL.md.",
  ]);
});
