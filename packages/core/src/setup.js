// Set up a product repo for Journeys First: copy the package's skills into the
// agent's skills folder, add a Playwright config if there is none, keep run
// folders out of git, add the workflow that upgrades Journeys First, and add
// the Journeys section to the repo's agent instructions. init does it once;
// upgrade refreshes the skills, the workflow and the Journeys section.
// Each returns one line per skill and per change, for the CLI to print.
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The published package has skills/ next to src/ (prepack copies it in). A
// checkout of the repo has them at the repo root.
const PACKAGED_SKILLS = fileURLToPath(new URL("../skills", import.meta.url));
const SKILLS = existsSync(PACKAGED_SKILLS) ? PACKAGED_SKILLS : fileURLToPath(new URL("../../../skills", import.meta.url));
const CONFIG_TEMPLATE = fileURLToPath(new URL("../templates/playwright.config.js", import.meta.url));
const WORKFLOW_TEMPLATE = fileURLToPath(new URL("../templates/journeysfirst-upgrade.yml", import.meta.url));
export const UPGRADE_WORKFLOW = ".github/workflows/journeysfirst-upgrade.yml";
const CONFIGS = ["js", "ts", "mjs", "cjs", "mts", "cts"].map((ext) => `playwright.config.${ext}`);
const REPORTER = `reporter: [["list"], ["journeysfirst/reporter", { outputDir: "journey-runs" }]]`;
const TRACE = `trace: "retain-on-failure"`;
const INSTRUCTIONS = ["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md"];
const SECTION_START = "<!-- journeysfirst:start -->";
const SECTION_END = "<!-- journeysfirst:end -->";

export const DEFAULT_SKILLS_DIR = ".claude/skills";
const FALLBACK_SKILLS_DIR = ".agents/skills";

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
 * When upgrade is called without --skills, look in .claude/skills first and
 * fall back to .agents/skills (where `npx skills add` installs for Codex and others).
 * @param {string} root @param {string | undefined} skillsDir
 */
function resolveUpgradeSkillsDir(root, skillsDir) {
  if (skillsDir) return skillsDir;
  if (hasOurSkills(root, DEFAULT_SKILLS_DIR)) return DEFAULT_SKILLS_DIR;
  if (hasOurSkills(root, FALLBACK_SKILLS_DIR)) return FALLBACK_SKILLS_DIR;
  return DEFAULT_SKILLS_DIR;
}

/**
 * Set up a repo that has no Journeys First skills yet.
 * @param {{root?: string, skillsDir?: string}} [options]
 * @returns {string[]} one line per change
 */
export function init({ root = process.cwd(), skillsDir = DEFAULT_SKILLS_DIR } = {}) {
  const there = packageSkills().filter((name) => existsSync(join(root, skillsDir, name)));
  if (there.length) throw new Error(`${skillsDir} already has ${there.join(", ")}. Run npx journeysfirst upgrade to refresh the skills.`);
  return [...copySkills(root, skillsDir), ...addConfig(root), ...ignoreRuns(root), ...writeWorkflow(root, skillsDir), ...addSection(root, skillsDir)];
}

/**
 * Refresh the skills in a repo set up by any earlier version. Only folders named
 * after a package skill, current or retired, are written or deleted.
 * @param {{root?: string, skillsDir?: string}} [options]
 * @returns {string[]} one line per change
 */
export function upgrade({ root = process.cwd(), skillsDir } = {}) {
  const dir = resolveUpgradeSkillsDir(root, skillsDir);
  if (!hasOurSkills(root, dir)) {
    throw new Error(`No Journeys First skills in ${dir}. Run npx journeysfirst init, or pass --skills <folder> if the skills are somewhere else.`);
  }
  const removed = RETIRED_SKILLS.filter((name) => existsSync(join(root, dir, name))).map((name) => {
    rmSync(join(root, dir, name), { recursive: true });
    return `removed ${join(dir, name)} (this version no longer ships it)`;
  });
  return [...copySkills(root, dir), ...removed, ...addConfig(root), ...ignoreRuns(root), ...writeWorkflow(root, dir), ...addSection(root, dir)];
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

/** @param {string} root */
function addConfig(root) {
  const config = CONFIGS.find((name) => existsSync(join(root, name)));
  if (!config) {
    const { command, says } = startCommand(root);
    writeFileSync(join(root, CONFIGS[0]), readFileSync(CONFIG_TEMPLATE, "utf8").replace(`command: "npm run dev",`, `command: ${JSON.stringify(command)},`));
    return [`added ${CONFIGS[0]}: ${says}`];
  }
  const text = readFileSync(join(root, config), "utf8");
  return [
    ...(text.includes("journeysfirst/reporter") ? [] : [`kept ${config}. It has no Journeys First reporter: add ${REPORTER}`]),
    ...keepTraceOnFailure(root, config, text),
  ];
}

/**
 * How the new Playwright config starts the app: the dev script, else the start
 * script. With neither, a command that fails and says what to set.
 * @param {string} root
 */
function startCommand(root) {
  const scripts = readPackage(root)?.scripts ?? {};
  if (scripts.dev) return { command: "npm run dev", says: "webServer starts the app with npm run dev, on the port in JOURNEYS_PORT (4321 if unset). Check that the app listens on PORT" };
  if (scripts.start) return { command: "npm start", says: "webServer starts the app with npm start, on the port in JOURNEYS_PORT (4321 if unset). Check that the app listens on PORT" };
  return {
    command: `echo "Set webServer.command in ${CONFIGS[0]} to the command that starts this app." >&2 && exit 1`,
    says: "package.json has no dev or start script. Set webServer's command to the command that starts this app",
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

/**
 * The Journeys section of the repo's agent instructions. An agent reads it at
 * the start of every task, so it runs the journeys a change touches without
 * being asked. A skill loads only when an ask matches it; this section is what
 * starts work nobody asked for.
 * @param {string} skillsDir
 */
export function journeysSection(skillsDir) {
  const skill = (/** @type {string} */ name) => `${skillsDir}/${name}/SKILL.md`;
  return `${SECTION_START}
## Journeys

The promises users rely on are listed in \`journeys/README.md\`. Its Foundation section says who the users are, what good means to them, and the product's UX rules, brand and design system. Each promise has a journey in \`journeys/\`. \`npx journeysfirst init\` or \`npx journeysfirst upgrade\` wrote this section. Each upgrade writes it again.

- Before you say a change a user can see is done, run the journeys it touches and check each run with \`npx journeysfirst validate-run\`. How: \`${skill("journey-run")}\`.
- Then review each run with \`${skill("journey-review")}\`. The change is done when the run passed and the review found nothing, or a person has seen the findings. Nobody to ask: fix them, or list them in your report.
- If your change adds a promise, propose a new journey and ask the person before you write it. On a new build the request is the agreement: write it (\`${skill("journey-write")}\`).
- If a journey fails, or a review has a finding, follow \`${skill("journey-fix")}\`. Never edit a check to make it pass, and never delete a finding.
- If the product changed, update \`journeys/README.md\`.
- No \`journeys/README.md\` yet: follow \`${skill("journey-onboard")}\`. No product yet, only a request: follow \`${skill("journey-build")}\`.
${SECTION_END}
`;
}

/**
 * Write the Journeys section into AGENTS.md, made if missing, and into each
 * CLAUDE.md that does not import AGENTS.md (one that does gets it from there).
 * @param {string} root
 * @param {string} skillsDir
 */
function addSection(root, skillsDir) {
  const changes = [];
  const files = INSTRUCTIONS.filter((name) => name === "AGENTS.md" || existsSync(join(root, name)));
  for (const name of files) {
    const file = join(root, name);
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (name !== "AGENTS.md" && text.includes("@AGENTS.md")) continue;
    const section = journeysSection(skillsDir);
    const start = text.indexOf(SECTION_START);
    const end = text.indexOf(SECTION_END);
    if (start !== -1 && end > start) {
      const next = text.slice(0, start) + section + text.slice(end + SECTION_END.length).replace(/^\n/, "");
      if (next === text) continue;
      writeFileSync(file, next);
      changes.push(`updated the Journeys section in ${name}`);
    } else {
      writeFileSync(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${text ? "\n" : ""}${section}`);
      changes.push(`${text ? "added the Journeys section to" : "added"} ${name}`);
    }
  }
  return changes;
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
  const dir = command === "upgrade" ? resolveUpgradeSkillsDir(root, skillsDir) : (skillsDir ?? DEFAULT_SKILLS_DIR);
  const skill = (/** @type {string} */ name) => `${dir}/${name}/SKILL.md`;
  const steps = [];
  const pkg = readPackage(root);
  const readme = join(root, "journeys/README.md");
  const firstInstall = !hasFiles(join(root, "journeys"), ".journey.yaml") && !hasFiles(join(root, "e2e"), "");
  if (command === "upgrade" && !firstInstall) {
    steps.push(`Check each saved script in e2e/ against the evidence rules in ${skill("journey-run")}. A read made with a service or admin key must say key, with the env var name the product's own code reads for that key (like SUPABASE_SERVICE_ROLE_KEY), not login.`);
    if (existsSync(readme) && !/^## Foundation\b/m.test(readFileSync(readme, "utf8"))) {
      steps.push(`journeys/README.md has no Foundation section. Add it before you run the journeys: follow "Find the foundation" in ${skill("journey-onboard")}.`);
    }
    steps.push(`Run the journeys again with ${skill("journey-run")} and compare each result with the run from before the upgrade.`);
  }
  if (!pkg?.devDependencies?.["@playwright/test"] && !pkg?.dependencies?.["@playwright/test"]) {
    steps.push("Install Playwright, which runs the journeys: npm install --save-dev @playwright/test");
  }
  if (firstInstall) steps.push("Install the browser the journeys use: npx playwright install --only-shell chromium");
  if (!existsSync(readme)) steps.push(`No journeys/README.md yet: follow ${skill("journey-onboard")}.`);
  else if (command === "init") steps.push(`Follow ${skill("journey-write")} and ${skill("journey-run")}.`);
  return steps;
}

/** @param {string} dir @param {string} ending @returns {boolean} whether dir has a file ending so, at any depth */
function hasFiles(dir, ending) {
  if (!existsSync(dir)) return false;
  return readdirSync(dir, { recursive: true, withFileTypes: true }).some((entry) => entry.isFile() && entry.name.endsWith(ending));
}
