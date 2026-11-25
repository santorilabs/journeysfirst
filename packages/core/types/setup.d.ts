export declare const UPGRADE_WORKFLOW = ".github/workflows/journeysfirst-upgrade.yml";
export declare const DEFAULT_SKILLS_DIR = ".claude/skills";
/** init copies here unless --skills names one folder. .claude is first so a link from it into .agents is written through. */
export declare const DEFAULT_SKILL_DIRS: string[];
/** Skills an earlier release shipped and this one does not. upgrade deletes their copies. */
export declare const RETIRED_SKILLS: string[];
/** @returns {string[]} the names of the skills this package ships */
export declare function packageSkills(): string[];
/**
 * Set up a repo that has no Journeys First skills yet.
 * @param {{root?: string, skillsDir?: string, demo?: boolean, terminal?: boolean}} [options]
 *   demo: add the example page, journey and script even when the repo has a dev or start script.
 * @returns {string[]} one line per change
 */
export declare function init({ root, skillsDir, demo, terminal }?: {
    root?: string;
    skillsDir?: string;
    demo?: boolean;
    terminal?: boolean;
}): string[];
/**
 * Refresh the skills in a repo set up by any earlier version. Only folders named
 * after a package skill, current or retired, are written or deleted.
 * @param {{root?: string, skillsDir?: string}} [options]
 * @returns {string[]} one line per change
 */
export declare function upgrade({ root, skillsDir }?: {
    root?: string;
    skillsDir?: string;
}): string[];
/**
 * The upgrade workflow, with --skills in its upgrade command when the skills
 * are not in the default folder.
 * @param {string} skillsDir
 */
export declare function upgradeWorkflow(skillsDir: string): string;
/**
 * The Journeys section of the repo's agent instructions. An agent reads it at
 * the start of every task, so it runs the journeys a change touches without
 * being asked. A skill loads only when an ask matches it; this section is what
 * starts work nobody asked for.
 * @param {string} skillsDir
 */
export declare function journeysSection(skillsDir: string): string;
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
export declare function nextSteps(command: "init" | "upgrade", { root, skillsDir }?: {
    root?: string;
    skillsDir?: string;
}): string[];
