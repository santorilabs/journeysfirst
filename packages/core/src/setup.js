// Set up a product repo for Journeys First: copy the package's skills into the
// agent's skills folder, add a Playwright config if there is none, keep run
// folders out of git, and add the workflow that upgrades Journeys First.
// Init adds agent instructions only when asked. With no app to start,
// init also adds an example page, journey and script that pass. init does it once;
// upgrade refreshes the skills and the workflow.
// Each returns one line per skill and per change, for the CLI to print.
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MISSING_TARGET } from "./shared/target.js";

// The published package has skills/ next to src/ (prepack copies it in). A
// checkout of the repo has them at the repo root.
const PACKAGED_SKILLS = fileURLToPath(new URL("../skills", import.meta.url));
const SKILLS = existsSync(PACKAGED_SKILLS) ? PACKAGED_SKILLS : fileURLToPath(new URL("../../../skills", import.meta.url));
const CONFIG_TEMPLATE = fileURLToPath(new URL("../templates/playwright.config.js", import.meta.url));
const TERMINAL_MODE = ".journeysfirst-terminal";
const DEMO = fileURLToPath(new URL("../templates/demo", import.meta.url));
/** Text in every example file, so a repo that only has the example still counts as a first install. */
const EXAMPLE_MARK = "journeysfirst example";
const EXAMPLE_FILES = [
  ["index.html", "demo/index.html"],
  ["serve.mjs", "demo/serve.mjs"],
  ["see-the-example.journey.yaml", "journeys/see-the-example.journey.yaml"],
  ["see-the-example.spec.js", "e2e/see-the-example.spec.js"],
];
const WORKFLOW_TEMPLATE = fileURLToPath(new URL("../templates/journeysfirst-upgrade.yml", import.meta.url));
export const UPGRADE_WORKFLOW = ".github/workflows/journeysfirst-upgrade.yml";
const CONFIGS = ["js", "ts", "mjs", "cjs", "mts", "cts"].map((ext) => `playwright.config.${ext}`);
const REPORTER = `reporter: [["list"], ["journeysfirst/reporter", { outputDir: "journey-runs" }]]`;
const TRACE = `trace: "retain-on-failure"`;
const INSTRUCTIONS = ["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md"];
const SECTION_START = "<!-- journeysfirst:start -->";
const SECTION_END = "<!-- journeysfirst:end -->";

export const DEFAULT_SKILLS_DIR = ".claude/skills";
/** init copies here unless --skills names one folder. .claude is first so a link from it into .agents is written through. */
export const DEFAULT_SKILL_DIRS = [".claude/skills", ".agents/skills"];

/** Skills an earlier release shipped and this one does not. upgrade deletes their copies. */
export const RETIRED_SKILLS = ["install-journeysfirst", "prove-check", "onboard", "write-journey", "run-journey", "fix-journey-run"];

/** @returns {string[]} the names of the skills this package ships */
export function packageSkills() {
  return readdirSync(SKILLS).sort();
}

/** @param {string} root @param {string} dir */
function hasOurSkills(root, dir) {
  const ours = [...packageSkills(), ...RETIRED_SKILLS];
  return ours.some((name) => existsSync(join(root, dir, name)));
}

/**
 * Folders init writes. No --skills means both defaults. --skills names one.
 * @param {string | undefined} skillsDir
 * @returns {string[]}
 */
function skillDestinations(skillsDir) {
  return skillsDir ? [skillsDir] : [...DEFAULT_SKILL_DIRS];
}

/**
 * The folder the Journeys section and the next steps name. .claude/skills when
 * it is one of the folders, so a repo with both copies keeps the same links.
 * @param {string} root
 * @param {string | undefined} skillsDir
 */
function citedSkillsDir(root, skillsDir) {
  if (skillsDir) return skillsDir;
  if (hasOurSkills(root, DEFAULT_SKILLS_DIR)) return DEFAULT_SKILLS_DIR;
  const other = DEFAULT_SKILL_DIRS.find((dir) => dir !== DEFAULT_SKILLS_DIR && hasOurSkills(root, dir));
  return other ?? DEFAULT_SKILLS_DIR;
}

/**
 * Set up a repo that has no Journeys First skills yet.
 * @param {{root?: string, skillsDir?: string, demo?: boolean, terminal?: boolean, agentInstructions?: boolean}} [options]
 *   demo: add the example page, journey and script even when the repo has a dev or start script.
 * @returns {string[]} one line per change
 */
export function init({ root = process.cwd(), skillsDir, demo = false, terminal = false, agentInstructions = false } = {}) {
  if (terminal && demo) throw new Error("Choose either --terminal or --demo.");
  const dirs = skillDestinations(skillsDir);
  if (agentInstructions && !terminal && !demo && dirs.some((dir) => hasOurSkills(root, dir))) {
    return addSection(root, citedSkillsDir(root, skillsDir));
  }
  for (const dir of dirs) {
    const there = packageSkills().filter((name) => existsSync(join(root, dir, name)));
    if (there.length) throw new Error(`${dir} already has ${there.join(", ")}. Run npx journeysfirst upgrade to refresh the skills.`);
  }
  const example = terminal ? { add: false, notes: [] } : exampleMode(root, demo);
  const cited = skillsDir ?? DEFAULT_SKILLS_DIR;
  if (terminal) writeFileSync(join(root, TERMINAL_MODE), "JourneysFirst records terminal runs without Playwright.\n");
  return [
    ...dirs.flatMap((dir) => copySkills(root, dir)),
    ...(terminal ? [`added ${TERMINAL_MODE}: skip browser setup`] : addConfig(root, { example: example.add })),
    ...(example.add ? addExample(root) : []),
    ...example.notes,
    ...ignoreRuns(root),
    ...writeWorkflow(root, cited),
    ...(agentInstructions ? addSection(root, cited) : []),
  ];
}

/**
 * Refresh the skills in a repo set up by any earlier version. Only folders named
 * after a package skill, current or retired, are written or deleted.
 * @param {{root?: string, skillsDir?: string}} [options]
 * @returns {string[]} one line per change
 */
export function upgrade({ root = process.cwd(), skillsDir } = {}) {
  // No --skills: refresh both default folders, and add the one an older init skipped.
  const dirs = skillsDir ? [skillsDir] : [...DEFAULT_SKILL_DIRS];
  if (!dirs.some((dir) => hasOurSkills(root, dir))) {
    const where = skillsDir ?? DEFAULT_SKILL_DIRS.join(" or ");
    throw new Error(`No Journeys First skills in ${where}. Run npx journeysfirst init, or pass --skills <folder> if the skills are somewhere else.`);
  }
  const removed = dirs.flatMap((dir) => RETIRED_SKILLS.filter((name) => existsSync(join(root, dir, name))).map((name) => {
    rmSync(join(root, dir, name), { recursive: true });
    return `removed ${join(dir, name)} (this version no longer ships it)`;
  }));
  const cited = skillsDir ?? DEFAULT_SKILLS_DIR;
  const config = existsSync(join(root, TERMINAL_MODE)) ? [] : addConfig(root);
  return [...dirs.flatMap((dir) => copySkills(root, dir)), ...removed, ...config, ...ignoreRuns(root), ...writeWorkflow(root, cited)];
}

/**
 * A skill folder can be a link to the real copy: `npx skills add` keeps skills
 * in .agents/skills and links .claude/skills to them. Write into the real copy.
 * @param {string} root @param {string} skillsDir
 */
function copySkills(root, skillsDir) {
  mkdirSync(join(root, skillsDir), { recursive: true });
  return packageSkills().flatMap((name) => {
    const to = join(skillsDir, name);
    const target = existsSync(join(root, to)) ? realpathSync(join(root, to)) : join(root, to);
    const file = join(target, "SKILL.md");
    const before = existsSync(file) ? readFileSync(file, "utf8") : null;
    cpSync(join(SKILLS, name), target, { recursive: true });
    if (before === null) return [`added ${to}`];
    if (before === readFileSync(file, "utf8")) return [`unchanged ${to}`];
    return [`updated ${to} (git diff shows what changed, including any local edits it replaced)`];
  });
}

/**
 * Whether this init should add the example, and any note when it should not.
 * The example is skipped when a Playwright config is already here: its script
 * opens whatever that config opens.
 * @param {string} root
 * @param {boolean} demo
 * @returns {{add: boolean, notes: string[]}}
 */
function exampleMode(root, demo) {
  const config = CONFIGS.find((name) => existsSync(join(root, name)));
  if (config) {
    return {
      add: false,
      notes: demo ? [`kept ${config}. --demo did not add the example, because this repo already has a Playwright config. The example would open whatever that config opens.`] : [],
    };
  }
  if (demo) return { add: true, notes: [] };
  const scripts = readPackage(root)?.scripts ?? {};
  if (scripts.dev || scripts.start || hasOwnWork(root)) return { add: false, notes: [] };
  return { add: true, notes: [] };
}

/**
 * Copy the example page, its server, the starter journey and the script.
 * Files already there are left as they are.
 * @param {string} root
 */
function addExample(root) {
  return EXAMPLE_FILES.map(([from, to]) => {
    const dest = join(root, to);
    if (existsSync(dest)) return `kept ${to}`;
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(DEMO, from), dest);
    return `added ${to}`;
  });
}

/** @param {string} root @param {{example?: boolean}} [options] */
function addConfig(root, { example = false } = {}) {
  const config = CONFIGS.find((name) => existsSync(join(root, name)));
  if (!config) {
    const { command, says, omitTarget } = startCommand(root, example);
    let text = readFileSync(CONFIG_TEMPLATE, "utf8").replace(`command: "npm run dev",`, `command: ${JSON.stringify(command)},`);
    if (omitTarget) text = configWithoutTarget(text);
    writeFileSync(join(root, CONFIGS[0]), text);
    return [`added ${CONFIGS[0]}: ${says}`];
  }
  const text = readFileSync(join(root, config), "utf8");
  return [
    ...(text.includes("journeysfirst/reporter") ? [] : [`kept ${config}. It has no Journeys First reporter: add ${REPORTER}`]),
    ...keepTraceOnFailure(root, config, text),
    ...targetGap(config, text),
  ];
}

/**
 * A config with neither address nor server cannot open a page. Say what to set.
 * @param {string} config
 * @param {string} text
 */
function targetGap(config, text) {
  if (/\bbaseURL\s*:/.test(text) || /\bwebServer\s*:/.test(text)) return [];
  return [`kept ${config}. ${MISSING_TARGET}`];
}

/**
 * Drop baseURL and webServer from a new config. Leaving a command that exits
 * makes Playwright report "was not able to start" and hides what to do.
 * The port constant stays, so the comment above it still matches the file.
 * @param {string} text
 */
function configWithoutTarget(text) {
  return text
    .replace("use: { baseURL: `http://localhost:${port}`, trace: \"retain-on-failure\" },", "use: { trace: \"retain-on-failure\" },")
    .replace(/\n  webServer: \{[\s\S]*?\n  \},/, "\n  // No baseURL or webServer yet. Set both when this app has a start command. To see a passing run first: npx journeysfirst init --demo");
}

/**
 * How the new Playwright config starts the app: the example page, the dev
 * script, else the start script. With none of those, baseURL and webServer
 * are left unset and the line says what to set.
 * @param {string} root
 * @param {boolean} example serve the bundled example page instead of the app
 * @returns {{command: string, says: string, omitTarget?: boolean}}
 */
function startCommand(root, example) {
  if (example) return { command: "node demo/serve.mjs", says: "webServer serves the example page in demo/, on the port in JOURNEYS_PORT (4321 if unset). npx playwright test runs journeys/see-the-example.journey.yaml. Point webServer at your app when you replace the example" };
  const scripts = readPackage(root)?.scripts ?? {};
  if (scripts.dev) return { command: "npm run dev", says: "webServer starts the app with npm run dev, on the port in JOURNEYS_PORT (4321 if unset). Check that the app listens on PORT" };
  if (scripts.start) return { command: "npm start", says: "webServer starts the app with npm start, on the port in JOURNEYS_PORT (4321 if unset). Check that the app listens on PORT" };
  return {
    command: "npm run dev",
    says: MISSING_TARGET,
    omitTarget: true,
  };
}

/** @param {string} root @returns {any} the parsed package.json, or null */
function readPackage(root) {
  const file = join(root, "package.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/**
 * Add trace: "retain-on-failure" to the config's use, so a failed run keeps
 * Playwright's trace. A config that sets trace anywhere is left as it is.
 * With no single use block to add it to, it says what to add.
 * @param {string} root @param {string} config @param {string} text
 */
function keepTraceOnFailure(root, config, text) {
  if (/\btrace\s*:/.test(text)) return [];
  const blocks = text.match(/\buse\s*:\s*\{/g) ?? [];
  if (blocks.length !== 1) return [`kept ${config}. A failed run keeps no Playwright trace: add ${TRACE} to use`];
  writeFileSync(join(root, config), text.replace(/\buse\s*:\s*\{/, (block) => `${block} ${TRACE},`));
  return [`added ${TRACE} to use in ${config}: a failed run keeps Playwright's trace`];
}

/** @param {string} root */
function ignoreRuns(root) {
  const file = join(root, ".gitignore");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = text.split("\n").map((line) => line.trim());
  const missing = ["journey-runs", "test-results"].filter((name) => !lines.some((line) => new RegExp(`^/?${name}/?$`).test(line)));
  if (!missing.length) return [];
  const prefix = text && !text.endsWith("\n") ? "\n" : "";
  appendFileSync(file, `${prefix}${missing.map((name) => `${name}/`).join("\n")}\n`);
  return missing.map((name) => `added ${name}/ to .gitignore`);
}

/**
 * The upgrade workflow, with --skills in its upgrade command when the skills
 * are not in the default folder.
 * @param {string} skillsDir
 */
export function upgradeWorkflow(skillsDir) {
  const text = readFileSync(WORKFLOW_TEMPLATE, "utf8");
  return skillsDir === DEFAULT_SKILLS_DIR ? text : text.replace("journeysfirst upgrade |", `journeysfirst upgrade --skills ${skillsDir} |`);
}

/** @param {string} root @param {string} skillsDir */
function writeWorkflow(root, skillsDir) {
  const file = join(root, UPGRADE_WORKFLOW);
  const before = existsSync(file) ? readFileSync(file, "utf8") : null;
  const text = upgradeWorkflow(skillsDir);
  if (before === text) return [];
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(file, text);
  if (before !== null) return [`updated ${UPGRADE_WORKFLOW}`];
  return [`added ${UPGRADE_WORKFLOW}: it says when npm has a new version, and opens a pull request for it once the JOURNEYSFIRST_TOKEN secret is set (docs/auto-upgrade.md in santorilabs/journeysfirst)`];
}

/** @param {string} skillsDir */
export function journeysSection(skillsDir) {
  return `${SECTION_START}
## Journeys

When a change affects something users see or do, write or update its journey in \`journeys/\`.
Before saying the change is done, run it with \`npx journeysfirst run journeys/<name>.journey.yaml\`.
Follow \`${skillsDir}/journey-run/SKILL.md\` for browser replays or journeys with more than one user.
Check the saved result. Report failed or unchecked steps instead of calling them passed.
${SECTION_END}
`;
}

/** @param {{root?: string, skillsDir?: string}} [options] */
export function instructionProposal({ root = process.cwd(), skillsDir } = {}) {
  const name = INSTRUCTIONS.find((path) => existsSync(join(root, path))) ?? "AGENTS.md";
  const file = join(root, name);
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  return { name, text, section: journeysSection(citedSkillsDir(root, skillsDir)) };
}

/** @param {string} root @param {string} skillsDir */
function addSection(root, skillsDir) {
  const { name, text, section } = instructionProposal({ root, skillsDir });
  const start = text.indexOf(SECTION_START);
  const end = text.indexOf(SECTION_END);
  if (start !== -1 && end <= start) throw new Error(`Fix the unfinished Journeys section in ${name} before running init again.`);
  const replace = start !== -1;
  const next = replace ? text.slice(0, start) + section + text.slice(end + SECTION_END.length).replace(/^\r?\n/, "")
    : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${text ? "\n" : ""}${section}`;
  if (next === text) return [`unchanged ${name}`];
  writeFileSync(join(root, name), next);
  return [`${replace ? "updated the Journeys section in" : text ? "added the Journeys section to" : "added"} ${name}`];
}

/**
 * What the agent does after init or upgrade. A repo with no journeys/README.md
 * is not onboarded yet, even if it was set up before that file existed, so both
 * go to journey-onboard. A repo with no journeys and no scripts in e2e/ is a
 * first install: there is nothing to re-check or re-run, but Playwright and its
 * browser may be missing. Setup never edits package.json: a dependency added
 * there is not installed until npm install runs, so it prints the command.
 * @param {"init"|"upgrade"} command @param {{root?: string, skillsDir?: string}} [options]
 * @returns {string[]}
 */
export function nextSteps(command, { root = process.cwd(), skillsDir } = {}) {
  const dir = command === "upgrade" ? citedSkillsDir(root, skillsDir) : (skillsDir ?? DEFAULT_SKILLS_DIR);
  const skill = (/** @type {string} */ name) => `${dir}/${name}/SKILL.md`;
  const steps = [];
  const pkg = readPackage(root);
  const readme = join(root, "journeys/README.md");
  const firstInstall = !hasOwnWork(root);
  const browser = !existsSync(join(root, TERMINAL_MODE));
  if (browser && command === "upgrade" && !firstInstall) {
    steps.push(`Check each saved script in e2e/ against the evidence rules in ${skill("journey-run")}. A read made with a service or admin key must say key, with the env var name the product's own code reads for that key, not login.`);
    if (existsSync(readme) && !/^## Foundation\b/m.test(readFileSync(readme, "utf8"))) {
      steps.push(`journeys/README.md has no Foundation section. Add it before you run the journeys: follow "Find the foundation" in ${skill("journey-onboard")}.`);
    }
    steps.push(`Run the journeys again with ${skill("journey-run")} and compare each result with the run from before the upgrade.`);
  }
  if (browser && !pkg?.devDependencies?.["@playwright/test"] && !pkg?.dependencies?.["@playwright/test"]) {
    steps.push("Install Playwright, which runs the journeys: npm install --save-dev @playwright/test");
  }
  if (browser && firstInstall && !chromiumInstalled(root)) {
    steps.push("Install the browser the journeys use: npx playwright install --only-shell chromium");
  }
  if (!existsSync(readme)) steps.push(`No journeys/README.md yet: follow ${skill("journey-onboard")}.`);
  else if (command === "init") steps.push(`Follow ${skill("journey-write")} and ${skill("journey-run")}.`);
  return steps;
}

/** @param {string} root */
function chromiumInstalled(root) {
  try {
    const require = createRequire(resolve(root, "package.json"));
    const cli = join(dirname(require.resolve("@playwright/test/package.json")), "cli.js");
    const plan = execFileSync(process.execPath, [cli, "install", "--dry-run", "--only-shell", "chromium"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000,
    });
    const target = plan.match(/^\s*Install location:\s*([^\r\n]*[\\/]chromium_headless_shell-[^\r\n]+)$/m)?.[1].trim();
    return Boolean(target && existsSync(join(target, "INSTALLATION_COMPLETE")));
  } catch {
    return false;
  }
}

/**
 * A journey or an e2e script that is not the example init may have added.
 * The example is marked, so it does not count as the product's own work.
 * @param {string} root
 */
function hasOwnWork(root) {
  const journeys = filesUnder(join(root, "journeys")).filter((file) => file.endsWith(".journey.yaml"));
  const scripts = filesUnder(join(root, "e2e"));
  return [...journeys, ...scripts].some((file) => !readFileSync(file, "utf8").includes(EXAMPLE_MARK));
}

/** @param {string} dir @returns {string[]} files at any depth */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const found = [];
  const walk = (/** @type {string} */ current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) found.push(file);
    }
  };
  walk(dir);
  return found;
}
