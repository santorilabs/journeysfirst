#!/usr/bin/env node
// journeysfirst validate <file...>                                check journey files
// journeysfirst validate-run <run folder...> [--journey <file>]   check run folders, or the newest run of a journey
// journeysfirst measured <run folder>                             what the run's measure files say, for a review
// journeysfirst add-findings <run folder> <findings file>        write a review's findings into a run
// journeysfirst add-review <run folder> --on <id> --by <who> --says <words>   record a person's call on a check or a finding
// journeysfirst review [dir] [--port n] [--host h] [--out dir]   browse or export the review UI
// journeysfirst run <journey> --agent "<command>"                  run your own agent on a fresh project copy and save a run
// journeysfirst publish <run folder> [--to url] [--journey file]   publish a run (token from JOURNEYSFIRST_TOKEN)
// journeysfirst dev-server [--port n] [--host h]                 a local in-memory service to publish to
// journeysfirst affected <path...>                               which journeys cover these changed paths
// journeysfirst merge-check [runs folder] [--main <runs folder>]   may this change merge, from the runs of every journey
// journeysfirst report <run folder>                              write report.html into the run folder
// journeysfirst summary <run folder>                             print a markdown summary for a pull request
// journeysfirst doctor                                           check Node, Playwright, the config, baseURL and the journeys
// journeysfirst init [--skills dir] [--demo | --terminal]        set up this repo for Journeys First
// journeysfirst upgrade [--skills dir]                           refresh the skills after installing a new version
import { FORMAT_V0, caseIds, journeyVersion, journeyWarnings, loadJourney, validateJourney } from "../src/format/format.js";
import { startDevServer } from "../src/publish/dev-server.js";
import { publishRun } from "../src/publish/publish.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addFindings, addReview, findJourney, newestRunFolder, readRunFolder, readRunJson } from "../src/format/run-folder.js";
import { measuredReport } from "../src/review/measured.js";
import { summaryMarkdown, writeReport } from "../src/review/report.js";
import { serveReview } from "../src/review/review.js";
import { exportReview } from "../src/review/export.js";
import { affectedLines } from "../src/format/affected.js";
import { mergeCheck } from "../src/format/merge-check.js";
import { doctor } from "../src/doctor.js";
import { init, instructionProposal, nextSteps, upgrade } from "../src/setup.js";
import { reviewLine } from "../src/shared/display.js";
import { VERSION } from "../src/shared/version.js";
import { captureCommand } from "../src/runner/capture.js";
import { readMcpServers, runAgent } from "../src/runner/agent.js";
import { selectAdapter } from "../src/runner/agents/index.js";

const USAGE = `Usage:
  journeysfirst --version
  journeysfirst validate <journey file...>
  journeysfirst validate-run <run folder...> [--journey <journey file>]
      A journey's folder of runs, like journey-runs/share-by-link, checks its newest run.
      Without --journey, it compares the steps with journeys/<name>.journey.yaml when that file exists.
  journeysfirst measured <run folder>
      Prints what the run's measure files say, for a review: one line for each measured fact a criterion names.
      It compares with the earlier reviewed run of the journey. With none, it lists the values the run uses, to check against the design system journeys/README.md links to.
      For a run with an MCP transcript, it also prints the tool calls: how many, how many returned an error, the wait, and the slowest.
      It shows them beside the average of up to 10 earlier passed runs. A tool call that returned an error is a fact line.
  journeysfirst add-findings <run folder> <findings file> [--journey <file>]
      Writes a review's findings into the run. The file is {"findings": [...]}, with an empty list when the review found nothing.
      Nothing else in the run changes: a finding never changes a verdict or the result. Do it before publish.
  journeysfirst add-review <run folder> --on <check or finding id> --by <person> --says "<their words>"
      Records a person's call in the run's reviews. It never changes a verdict or the result. Do it before publish.
  journeysfirst review [runs folder] [--port <n>] [--host <address>]   (default port 4400, or PORT; host 127.0.0.1)
  journeysfirst review [runs folder] --out <new folder> [--include-transcripts]
      Export a static review. Check the pages and recordings for private data before hosting the folder.
      Include attached transcripts only with --include-transcripts, after checking them for private data.
  journeysfirst capture --out <new file> [--secret-env <NAME,NAME>] -- <command> [args...]
      Run a terminal command and save bounded, redacted output.
  journeysfirst mcp-proxy --out <new file> [--secret-env <NAME,NAME>] -- <server command> [args...]
      Relay an MCP server's stdio and save request names and redacted reply text.
      Each reply is saved with how long its request waited, in ms, and whether it was an error.
  journeysfirst run <journey.yaml> [--agent <name-or-command>] [--project <folder>] [--case <id>] [--mcp <json>] [--container <image> | --allow-host-read] [--timeout <seconds>] -- [--model <name>]
      Use a signed-in agent CLI in a scratch copy of the project. Records configured stdio MCP servers unless --mcp overrides them.
  journeysfirst publish <run folder> [--to <url>] [--journey <file>]   (default JOURNEYSFIRST_URL; token from JOURNEYSFIRST_TOKEN)
  journeysfirst dev-server [--port <n>] [--host <address>]   (default port 4500; host 127.0.0.1)
  journeysfirst affected <path...>
      Prints run or skip for each journey in journeys/, from journeys/covered-by.yaml.
      A journey runs when a path matches one it covers. A journey with no entry is skipped.
  journeysfirst merge-check [runs folder] [--main <runs folder>]   (default journey-runs)
      Ok only when every journey in journeys/ has a valid run in which every check passed.
      A blocked check is ok only if the same check was blocked in main's newest run, in --main.
  journeysfirst report <run folder>
      Writes report.html into the run folder. Open it in a browser. Images are the screenshots beside it.
  journeysfirst summary <run folder>
      Prints markdown for a pull request: the result, each line, and why. It does not include images or video.
  journeysfirst doctor
      Checks Node, Playwright, Chromium, playwright.config.js, whether baseURL answers, and each journey file.
      A failed check says what to run next. Chromium is installed with: npx playwright install --only-shell chromium
  journeysfirst init [--skills <folder>] [--demo | --terminal] [--agent-instructions]
      Create journeys/, set up the skills, and show a proposed Journeys section. Pass --agent-instructions to approve writing it to the project's agent instructions.
      Skills go to .agents/skills and .claude/skills. --skills <folder> copies to that folder only.
      With no dev or start script, also add an example page, journey and script that pass. --demo adds that example even when a dev or start script exists.
      When baseURL and webServer are both missing, init says what to set.
      --terminal skips the browser setup and demo for terminal or MCP journeys.
  journeysfirst upgrade [--skills <folder>]   after installing a new version: refresh the copied skills and delete retired ones
      With no --skills, upgrade refreshes .agents/skills and .claude/skills. The app's own skill is never touched.`;

const [command, ...rest] = process.argv.slice(2);
const { positional, flags } = parseArgs(rest);

if (command === "run") {
  try {
    const end = rest.indexOf("--");
    const { positional, flags } = parseArgs(end === -1 ? rest : rest.slice(0, end));
    if (positional.length !== 1 ||
        Object.entries(flags).some(([name, value]) => name === "allow-host-read" ? value !== true
          : !["agent", "project", "case", "mcp", "container", "timeout"].includes(name) || typeof value !== "string") ||
        (flags.container && flags["allow-host-read"])) {
      throw new Error("Use journeysfirst run <journey.yaml>. See --help for options.");
    }
    const timeoutMs = timeoutFlag(flags.timeout);
    const adapter = selectAdapter(flags.agent, flags.container);
    if (!flags.agent && adapter) console.error(`Using ${adapter.name}. Pass --agent <name> to override.`);
    if (!adapter) {
      if (!flags.agent?.trim() || flags.container || flags["allow-host-read"] || (end !== -1 && end < rest.length - 1)) {
        throw new Error('Use journeysfirst run <journey.yaml> --agent "<command>". Put agent flags inside the command. A custom command cannot use --container or --allow-host-read.');
      }
      console.error("Running a custom agent command. Journeys First does not verify its sandbox.");
    }
    if (adapter && !flags.container) console.error("Running without a container. Agent commands use its permission sandbox; the agent process runs on this machine.");
    if (flags["allow-host-read"]) console.error("Host files, including files in your home directory, can be read by agent commands.");
    const project = flags.project ?? process.cwd();
    const options = { journey: positional[0], caseId: flags.case, project, mcp: readMcpServers(flags.mcp, project), timeoutMs };
    if (!adapter && Object.keys(options.mcp).length) {
      console.error(`Configured MCP proxies from ${flags.mcp ? "--mcp" : ".mcp.json"}: ${Object.keys(options.mcp).join(", ")}. The command must read .mcp.json to use them.`);
    }
    const saved = adapter ? await adapter.start({ ...options, container: flags.container, allowHostRead: flags["allow-host-read"], mcpOverride: flags.mcp !== undefined,
      agentArgs: end === -1 ? [] : rest.slice(end + 1) }) : await runAgent({ ...options, command: flags.agent });
    console.log(`Saved ${saved.run.result} run to ${saved.folder}.`);
    console.log(`Next: npx journeysfirst validate-run ${JSON.stringify(saved.folder)}\nThen follow journey-review.`);
    if (saved.problem) { console.error(saved.problem); process.exitCode = saved.exitCode; }
    else if (saved.run.result !== "passed") console.log("Exit 0 means the agent finished and a run was saved. The journey did not pass.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (command === "capture" || command === "mcp-proxy") {
  try {
    const end = rest.indexOf("--");
    const { positional, flags } = parseArgs(rest.slice(0, end));
    if (end < 0 || !rest[end + 1] || typeof flags.out !== "string" || !flags.out || positional.length ||
        Object.keys(flags).some((name) => name !== "out" && name !== "secret-env")) {
      throw new Error("Give --out <new file> followed by -- and a command.");
    }
    const names = flags["secret-env"];
    if (names !== undefined && (typeof names !== "string" || !/^[A-Za-z_][\w]*(?:,[A-Za-z_][\w]*)*$/.test(names))) {
      throw new Error("Give environment variable names separated by commas to --secret-env.");
    }
    const secrets = typeof names === "string" ? names.split(",").map((name) => process.env[name]).filter(Boolean) : [];
    process.exitCode = await captureCommand(rest.slice(end + 1), { out: flags.out, mcp: command === "mcp-proxy", secrets });
  } catch (error) {
    console.error(error.code === "EEXIST" ? "The capture file exists. Choose a new file with --out." : error.message);
    process.exitCode = 1;
  }
} else if (command === "--version" || command === "version") {
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
      if (!Array.isArray(run.findings)) {
        console.log("  Follow journey-review, then run: npx journeysfirst add-findings <run folder> <findings file>");
      }
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
  const dir = positional[0] ?? "journey-runs";
  if (flags.out !== undefined) {
    try {
      if (typeof flags.out !== "string" || !flags.out) throw new Error("Give --out the name of a new folder.");
      const includeTranscripts = flags["include-transcripts"] === true || flags["include-transcripts"] === "true";
      console.log(`Exported review to ${exportReview(dir, flags.out, { includeTranscripts })}. Check the pages and recordings for private data before sharing.`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  } else {
    serveReview({ dir, port: Number(flags.port ?? process.env.PORT ?? 4400), host: flags.host });
  }
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
} else if (command === "affected") {
  if (!positional.length) {
    console.error("Name the files that changed: journeysfirst affected <path>...");
    process.exit(1);
  }
  try {
    for (const line of affectedLines(process.cwd(), positional)) console.log(line);
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
} else if (command === "report" && positional[0]) {
  try {
    console.log(writeReport(positional[0]));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else if (command === "summary" && positional[0]) {
  try {
    console.log(summaryMarkdown(readRunFolder(positional[0]).run));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else if (command === "doctor") {
  try {
    const { ok, lines } = await doctor();
    for (const line of lines) console.log(`${line.ok ? "ok" : "NO"} ${line.name}: ${line.says}`);
    if (!ok) console.log("Fix the lines marked NO, then run journeysfirst doctor again.");
    process.exit(ok ? 0 : 1);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else if (command === "init" || command === "upgrade") {
  try {
    const demo = flags.demo === true || flags.demo === "true";
    const terminal = flags.terminal === true || flags.terminal === "true";
    const agentInstructions = flags["agent-instructions"] === true;
    if (flags["agent-instructions"] !== undefined && (command !== "init" || !agentInstructions)) {
      throw new Error("Use journeysfirst init --agent-instructions to approve writing the proposed section.");
    }
    const changes = command === "init" ? init({ skillsDir: flags.skills, demo, terminal, agentInstructions }) : upgrade({ skillsDir: flags.skills });
    console.log(`journeysfirst ${VERSION} ${command}`);
    console.log(changes.map((line) => `  ${line}`).join("\n"));
    if (changes.every((line) => line.startsWith("unchanged "))) console.log("  Nothing changed.");
    if (command === "init" && !agentInstructions) {
      const { files, section } = instructionProposal({ skillsDir: flags.skills });
      console.log(`\nProposed addition to ${files.map(({ name }) => name).join(", ")} (not written):\n${section}\nTo approve it, run npx journeysfirst init --agent-instructions${flags.skills ? " --skills " + JSON.stringify(flags.skills) : ""}.`);
    }
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

/** @param {unknown} value seconds from --timeout */
function timeoutFlag(value) {
  if (value === undefined) return undefined;
  const ms = Number(value) * 1000;
  if (!Number.isFinite(ms) || ms < 1000 || ms > 3600000) throw new Error("Give --timeout a number of seconds between 1 and 3600.");
  return ms;
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
