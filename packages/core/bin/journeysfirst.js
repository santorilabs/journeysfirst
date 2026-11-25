#!/usr/bin/env node
// journeysfirst validate <file...>                                check journey files
// journeysfirst validate-run <run folder...> [--journey <file>]   check run folders, or the newest run of a journey
// journeysfirst measured <run folder>                             what the run's measure files say, for a review
// journeysfirst add-findings <run folder> <findings file>        write a review's findings into a run
// journeysfirst add-review <run folder> --on <id> --by <who> --says <words>   record a person's call on a check or a finding
// journeysfirst review [dir] [--port n] [--host h]               browse run folders in a local review UI
// journeysfirst publish <run folder> [--to url] [--journey file]   publish a run (token from JOURNEYSFIRST_TOKEN)
// journeysfirst dev-server [--port n] [--host h]                 a local in-memory service to publish to
// journeysfirst merge-check [runs folder] [--main <runs folder>]   may this change merge, from the runs of every journey
// journeysfirst init [--skills dir] [--demo]                     set up this repo: skills, Playwright config, .gitignore, and an example that passes when there is no app
// journeysfirst upgrade [--skills dir]                           refresh the skills after installing a new version
import { FORMAT_V0, caseIds, journeyVersion, journeyWarnings, loadJourney, validateJourney } from "../src/format/format.js";
import { startDevServer } from "../src/publish/dev-server.js";
import { publishRun } from "../src/publish/publish.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addFindings, addReview, findJourney, newestRunFolder, readRunFolder, readRunJson } from "../src/format/run-folder.js";
import { measuredReport } from "../src/review/measured.js";
import { serveReview } from "../src/review/review.js";
import { mergeCheck } from "../src/format/merge-check.js";
import { init, nextSteps, upgrade } from "../src/setup.js";
import { reviewLine } from "../src/shared/display.js";
import { VERSION } from "../src/shared/version.js";

const USAGE = `Usage:
  journeysfirst --version
  journeysfirst validate <journey file...>
  journeysfirst validate-run <run folder...> [--journey <journey file>]
      A journey's folder of runs, like journey-runs/share-by-link, checks its newest run.
      Without --journey, it compares the steps with journeys/<name>.journey.yaml when that file exists.
  journeysfirst measured <run folder>
      Prints what the run's measure files say, for a review: one line for each measured fact a criterion names.
      It compares with the earlier reviewed run of the journey and with the measured line in journeys/README.md.
  journeysfirst add-findings <run folder> <findings file> [--journey <file>]
      Writes a review's findings into the run. The file is {"findings": [...]}, with an empty list when the review found nothing.
      Nothing else in the run changes: a finding never changes a verdict or the result. Do it before publish.
  journeysfirst add-review <run folder> --on <check or finding id> --by <person> --says "<their words>"
      Records a person's call in the run's reviews. It never changes a verdict or the result. Do it before publish.
  journeysfirst review [runs folder] [--port <n>] [--host <address>]   (default port 4400, or PORT; host 127.0.0.1)
  journeysfirst publish <run folder> [--to <url>] [--journey <file>]   (default JOURNEYSFIRST_URL; token from JOURNEYSFIRST_TOKEN)
  journeysfirst dev-server [--port <n>] [--host <address>]   (default port 4500; host 127.0.0.1)
  journeysfirst merge-check [runs folder] [--main <runs folder>]   (default journey-runs)
      Ok only when every journey in journeys/ has a valid run in which every check passed.
      A blocked check is ok only if the same check was blocked in main's newest run, in --main.
  journeysfirst init [--skills <folder>] [--demo]
      Set up this repo: copy the skills, add playwright.config.js if there is none, ignore journey-runs/, write a Journeys section in AGENTS.md, add the upgrade workflow.
      Skills go to .agents/skills and .claude/skills. --skills <folder> copies to that folder only.
      With no dev or start script, also add an example page, journey and script that pass. --demo adds that example even when a dev or start script exists.
      When baseURL and webServer are both missing, init says what to set.
  journeysfirst upgrade [--skills <folder>]   after installing a new version: refresh the copied skills and delete retired ones
      With no --skills, upgrade refreshes .agents/skills and .claude/skills. The app's own skill is never touched.`;

const [command, ...rest] = process.argv.slice(2);
const { positional, flags } = parseArgs(rest);

if (command === "--version" || command === "version") {
  console.log(VERSION);
} else if (command === "--help" || command === "-h" || command === "help") {
  console.log(USAGE);
} else if (command === "validate" && positional.length) {
  let failed = false;
  for (const file of positional) {
    try {
      const journey = loadJourney(file);
      const problems = validateJourney(journey);
      if (problems.length) throw new Error(`${file}\n  - ${problems.join("\n  - ")}`);
      const cases = caseIds(journey).length;
      const legacy = journey.format === FORMAT_V0 ? "; draft 0, move it to journeysfirst/v1 when you can" : "";
      console.log(`${file}  ok  (version ${journeyVersion(journey)}${cases ? `; ${cases} cases` : ""}${legacy})`);
      for (const warning of journeyWarnings(journey)) console.log(`  note: ${warning}`);
    } catch (error) {
      failed = true;
      console.log(error.message);
    }
  }
  process.exit(failed ? 1 : 0);
} else if (command === "validate-run" && positional.length) {
  let failed = false;
  for (const given of positional) {
    const newest = existsSync(join(given, "run.json")) ? null : newestRunFolder(given);
    const folder = newest ?? given;
    try {
      if (newest) console.log(`Newest run in ${given}:`);
      const { run, digest, settled, compared } = openRun(folder);
      const checks = run.steps.filter((s) => s.check !== undefined);
      const passed = checks.filter((s) => s.verdict === "passed").length;
      console.log(`${folder}  ok  (${run.result.replaceAll("_", " ")}; ${passed} of ${checks.length} checks passed; digest ${digest.slice(0, 12)})`);
      if (settled.length) console.log(`  Claimed passes with no evidence from the right login count as not_checked: ${settled.join(", ")}.`);
      console.log(`  ${compared}`);
      console.log(`  ${reviewLine(run)}`);
    } catch (error) {
      failed = true;
      console.log(error.message);
    }
  }
  process.exit(failed ? 1 : 0);
} else if (command === "measured" && positional.length === 1) {
  try {
    console.log(measuredReport(positional[0]));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else if (command === "add-findings" && positional.length === 2) {
  try {
    const [folder, file] = positional;
    // The run must be valid as it is before anything is written to it.
    const { journey } = openRun(folder);
    let given;
    try {
      given = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`${file}: can't read the findings. ${error.message}`);
    }
    const run = addFindings(folder, given, { journey });
    console.log(`${folder}  ${reviewLine(run)}`);
    console.log(`  The result is still ${run.result.replaceAll("_", " ")}.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else if (command === "add-review" && positional.length === 1) {
  try {
    const [folder] = positional;
    const missing = ["on", "by", "says"].filter((flag) => typeof flags[flag] !== "string" || !flags[flag].trim());
    if (missing.length) throw new Error(`add-review needs ${missing.map((flag) => `--${flag}`).join(", ")}. Like: journeysfirst add-review ${folder} --on intuitive-feedback-1 --by ana@example.test --says "Keep it."`);
    const { journey } = openRun(folder);
    const run = addReview(folder, { on: flags.on, by: flags.by, says: flags.says }, { journey });
    console.log(`${folder}  ${reviewLine(run)}`);
    console.log(`  The result is still ${run.result.replaceAll("_", " ")}.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else if (command === "review") {
  serveReview({ dir: positional[0] ?? "journey-runs", port: Number(flags.port ?? process.env.PORT ?? 4400), host: flags.host });
} else if (command === "publish" && positional.length === 1) {
  try {
    const { journey, compared } = openRun(positional[0]);
    const result = await publishRun(positional[0], { to: flags.to ?? process.env.JOURNEYSFIRST_URL, journey });
    console.log(`Published run ${result.id}: ${result.state}${result.url ? ` at ${result.url}` : ""}`);
    if (result.url) console.log(`  Give this link to the person: ${result.url}`);
    if (result.unverified) console.log(`  ${compared}`);
    console.log(`  uploaded ${result.uploaded.length} file(s), already there ${result.skipped.length}; digest ${result.digest.slice(0, 12)}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else if (command === "merge-check") {
  try {
    const { ok, lines } = mergeCheck({ runsDir: positional[0] ?? "journey-runs", mainDir: flags.main });
    for (const line of lines) console.log(`${line.ok ? "ok " : "NO "} ${line.journey}${line.case ? ` (${line.case})` : ""}: ${line.says}`);
    const stopped = lines.filter((line) => !line.ok).length;
    console.log(ok ? `All ${lines.length} journeys may merge.` : `${stopped} of ${lines.length} journeys stop the merge. Fix them, or ask a person.`);
    process.exit(ok ? 0 : 1);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else if (command === "init" || command === "upgrade") {
  try {
    const demo = flags.demo === true || flags.demo === "true";
    const changes = command === "init" ? init({ skillsDir: flags.skills, demo }) : upgrade({ skillsDir: flags.skills });
    console.log(`journeysfirst ${VERSION} ${command}`);
    console.log(changes.map((line) => `  ${line}`).join("\n"));
    if (changes.every((line) => line.startsWith("unchanged "))) console.log("  Nothing changed.");
    console.log(`Next:\n${nextSteps(command, { skillsDir: flags.skills }).map((line) => `  ${line}`).join("\n")}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else if (command === "dev-server") {
  const server = await startDevServer({ port: Number(flags.port ?? 4500), host: flags.host, token: process.env.JOURNEYSFIRST_TOKEN });
  console.log(`journeysfirst dev-server: ${server.url}  (in memory; publish with --to ${server.url})`);
} else {
  console.log(USAGE);
  process.exit(command ? 1 : 0);
}

/**
 * Read and check a run folder, against its journey file when there is one. A
 * journey that changed since the run, or a mismatch, is an error.
 */
function openRun(folder) {
  const raw = readRunJson(folder);
  let found;
  try {
    found = findJourney(raw, flags.journey);
  } catch (error) {
    throw new Error(`${folder}: can't read the journey. ${error.message}`);
  }
  if (!found.journey) {
    return { ...readRunFolder(folder), journey: null, compared: `Unverified: steps not compared with the journey, because ${found.file} was not found. Pass --journey <file>.` };
  }
  try {
    return { ...readRunFolder(folder, { journey: found.journey }), journey: found.journey, compared: `Steps match ${found.file}.` };
  } catch (error) {
    throw new Error(error.message.replace("is not a valid run:", `is unverified against ${found.file}:`));
  }
}

function parseArgs(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const eq = args[i].indexOf("=");
      if (eq !== -1) flags[args[i].slice(2, eq)] = args[i].slice(eq + 1);
      else if (args[i + 1] === undefined || args[i + 1].startsWith("--")) flags[args[i].slice(2)] = true;
      else flags[args[i].slice(2)] = args[++i];
    } else positional.push(args[i]);
  }
  return { positional, flags };
}
