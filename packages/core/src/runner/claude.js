import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { RunRecorder } from "./recorder.js";
import { maskText } from "./mask.js";
import { agentPrompt, importResults, installDirectory, prepareWork, processResult, readSmall, saveRun } from "./codex.js";

const TOKEN = "CLAUDE_CODE_OAUTH_TOKEN";
const PROBE = "journeysfirst: workspace readable, provider login hidden";
const PROBE_COMMAND = "node .journeysfirst/probe.cjs";
const TOOLS = ["Bash", "Read", "Edit", "Write", "Glob", "Grep"];
// The PATH an MCP server gets. Bare server commands fall back to it, so the lookup and the server cannot disagree.
const SERVER_PATH = [dirname(process.execPath), "/usr/local/bin", "/usr/bin", "/bin"];

/**
 * Launch Claude Code with a fresh project, a clean home and a subscription login that its commands cannot read.
 * @param {{journey: string, caseId?: string, project?: string, mcp?: string, allowHostRead?: boolean, allowDomains?: string[], timeoutMs?: number, agentArgs: string[]}} options
 */
export async function runClaude({ journey, caseId, project, mcp, allowHostRead = false, allowDomains = [], timeoutMs = 180000, agentArgs }) {
  const selected = pickArgs(agentArgs);
  const run = RunRecorder.start({ journey, case: caseId, ranBy: { agent: "claude" }, playedBy: { you: "Claude" } });
  if (run.plan.everyone.some((user) => user !== "you")) {
    throw new Error("The Claude launcher only plays the 'you' seat. Use the recorder directly for journeys with more than one user.");
  }
  const token = process.env[TOKEN] ?? "";
  // Subscription tokens from `claude setup-token` start with sk-ant-oat. API keys, including organization keys, do not.
  if (!/^sk-ant-oat\d*-[\w-]+$/.test(token)) {
    throw new Error(`Set ${TOKEN} to a token from \`claude setup-token\`, signed in with your Claude subscription. The Claude launcher does not use API keys.`);
  }
  run.value(TOKEN, token, { secret: true });
  for (const domain of allowDomains) {
    if (!/^(\*\.)?[a-z0-9]([a-z0-9-]*\.)*[a-z0-9-]+(:\d{1,5})?$/i.test(domain)) throw new Error(`"${domain}" is not a domain. Give --allow-domains names like registry.npmjs.org or *.example.com.`);
  }
  const base = realpathSync(mkdtempSync(join(tmpdir(), "journeysfirst-claude-")));
  const work = join(base, "work"), home = join(base, "home"), config = join(base, "claude");
  const state = join(work, ".journeysfirst");
  const hostHome = allowHostRead ? undefined : realpathSync(homedir());
  let problem;
  let probeDir;
  try {
    prepareWork({ project, base, work });
    mkdirSync(home);
    mkdirSync(config);
    const configProbe = join(config, "probe.txt");
    writeFileSync(configProbe, "Synthetic probe. No login is in this file.\n");
    let hostProbe;
    if (hostHome) {
      probeDir = mkdtempSync(join(hostHome, ".journeysfirst-probe-"));
      hostProbe = join(probeDir, "host.txt");
      writeFileSync(hostProbe, "Synthetic host home probe.\n");
    }
    writeFileSync(join(state, "probe.cjs"), probeCode([configProbe, hostProbe].filter((path) => path !== undefined)));
    const env = {
      PATH: [...(process.env.PATH ?? "").split(":"), dirname(process.execPath)].join(":"),
      HOME: home, CLAUDE_CONFIG_DIR: config, LANG: "C.UTF-8",
      CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "3", CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    };
    const settings = JSON.stringify(settingsFor({ work, home, config, hostHome, allowDomains, servers: [] }));
    const probePrompt = [
      "This is a setup check before a test. Do only these two things, then reply with the single word done.",
      `1. Run this exact command with the Bash tool: ${PROBE_COMMAND}`,
      `2. Use the Read tool on ${configProbe}`,
    ].join("\n");
    const checked = await processResult("claude", [...baseArgs(settings, ["Bash", "Read"]), ...selected], { cwd: work, env, stdin: probePrompt, timeout: 120000 }, token);
    rmSync(configProbe, { force: true });
    if (events(checked.stdout).some((event) => event.error === "authentication_failed")) {
      throw new Error(`Claude Code could not sign in with ${TOKEN}. Make a new token with claude setup-token.`);
    }
    if (!probePassed(checked.stdout, configProbe)) {
      throw new Error("Claude Code could not prove that its sandbox hides the provider login and your home directory. Install bubblewrap and socat on Linux, check the token, or pass --allow-host-read to allow home reads.");
    }
    rmSync(join(state, "probe.cjs"), { force: true });
    const servers = mcp ? loadServers(mcp, state, home) : {};
    const full = JSON.stringify(settingsFor({ work, home, config, hostHome, allowDomains, servers: Object.keys(servers) }));
    const mcpArgs = mcp ? ["--mcp-config", JSON.stringify({ mcpServers: servers })] : [];
    const result = await processResult("claude", [...baseArgs(full, TOOLS, Object.keys(servers)), ...mcpArgs, ...selected], { cwd: work, env, stdin: agentPrompt(run), timeout: timeoutMs }, token);
    importResults(run, state);
    const final = finalMessage(result.stdout);
    if (result.timedOut) problem = "Claude reached the time limit.";
    else if (result.code !== 0 || final.error) problem = "Claude exited before completing the journey.";
    const failedServers = Object.keys(servers).flatMap((name) => {
      const code = readSmall(join(state, name + ".txt.exit"));
      return /^[1-9]\d{0,2}$/.test(code) ? [{ server: maskText(run.redact(name)), code: Number(code), cause: "environment" }] : [];
    });
    if (failedServers.length) {
      run.tag("mcp_server_failures", failedServers);
      problem = [problem, ...failedServers.map(({ server, code }) => `MCP server "${server}" exited with status ${code}.`)].filter(Boolean).join(" ");
    }
    if (final.text) run.attach({ name: "handoff.txt", body: maskText(run.redact(final.text)), kind: "transcript" });
  } catch (error) {
    problem = run.redact(error instanceof Error ? error.message : "Claude could not complete the journey.");
  } finally {
    if (probeDir) rmSync(probeDir, { recursive: true, force: true });
    rmSync(base, { recursive: true, force: true });
  }
  return saveRun(run, problem);
}

/** @param {string[]} args */
function pickArgs(args) {
  if (args.length > 2 || (args.length && (args.length !== 2 || args[0] !== "--model" || !/^[\w.\[\]-]+$/.test(args[1])))) {
    throw new Error("Pass only --model <name> after --. Journeys First sets the Claude prompt, tools and sandbox.");
  }
  return args;
}

/**
 * Anything not in the allowed tools is refused without a prompt. Claude Code needs the list on the command line
 * when it scrubs its subprocess environment.
 * @param {string} settings
 * @param {string[]} tools
 * @param {string[]} [servers]
 */
function baseArgs(settings, tools, servers = []) {
  return ["-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence",
    "--setting-sources", "user", "--settings", settings, "--strict-mcp-config",
    "--permission-prompts", "none", "--tools", tools.join(","),
    "--allowedTools", [...tools, ...servers.map((name) => `mcp__${name}`)].join(",")];
}

/**
 * Claude Code settings for one run. Commands run in Claude's sandbox or not at all.
 * File tools stay in the project. The login folder, and the home directory unless allowed, are hidden from commands.
 * @param {{work: string, home: string, config: string, hostHome?: string, allowDomains: string[], servers: string[]}} options
 */
function settingsFor({ work, home, config, hostHome, allowDomains, servers }) {
  // Node or Claude Code installed under the hidden home directory (nvm, ~/.local) must stay runnable.
  const inHome = (/** @type {string | undefined} */ dir) => {
    const path = dir && hostHome ? relative(hostHome, dir) : "..";
    return !path.startsWith("..") && !isAbsolute(path);
  };
  const allowRead = [dirname(process.execPath), installDirectory("claude")].filter(inHome);
  return {
    permissions: {
      allow: [...TOOLS, ...servers.map((name) => `mcp__${name}`)],
      blockFileToolReadsOutsideWorkingDirectories: true,
    },
    sandbox: {
      enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
      filesystem: { denyRead: [config, ...(hostHome ? [hostHome] : [])], allowRead, allowWrite: [work, home] },
      network: { allowedDomains: allowDomains },
    },
  };
}

/** @param {string} file @param {string} state @param {string} home */
function loadServers(file, state, home) {
  const config = JSON.parse(readFileSync(file, "utf8"));
  if (!config || Object.getPrototypeOf(config) !== Object.prototype) throw new Error("Give --mcp a JSON object of server names and command arrays.");
  /** @type {Record<string, {command: string, args: string[]}>} */
  const servers = {};
  for (const [name, argv] of Object.entries(config)) {
    if (!/^[\w-]+$/.test(name) || !Array.isArray(argv) || !argv.length || !argv.every((item) => typeof item === "string")) {
      throw new Error("Each MCP server needs a plain name and an array of command words.");
    }
    // env -i starts the server with only PATH and HOME, so nothing from Claude's environment reaches the product.
    // That PATH is short, so a bare command is found on the caller's PATH first.
    const [command, ...rest] = argv;
    servers[name] = { command: "env", args: ["-i", `PATH=${SERVER_PATH.join(":")}`, `HOME=${home}`,
      process.execPath, join(state, "codex-capture.mjs"), "mcp-proxy", name + ".txt", "--", onPath(command), ...rest] };
  }
  return servers;
}

/**
 * The full path of a bare command on the caller's PATH, or else on the PATH the server gets.
 * A command with a slash is kept as given.
 * @param {string} command
 */
function onPath(command) {
  if (command.includes("/")) return command;
  for (const dir of [...(process.env.PATH ?? "").split(":"), ...SERVER_PATH]) {
    if (!isAbsolute(dir)) continue;
    const path = join(dir, command);
    try {
      accessSync(path, constants.X_OK);
      if (statSync(path).isFile()) return path;
    } catch {}
  }
  throw new Error(`Could not find the MCP server command "${command}" on PATH. Give its full path in the --mcp file.`);
}

/**
 * Runs inside Claude's command sandbox: the project must be readable, the login and probe files must not be.
 * @param {string[]} hidden
 */
function probeCode(hidden) {
  return `const fs = require("node:fs");
fs.readdirSync(".");
for (const name of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR"]) {
  if (process.env[name]) process.exit(1);
}
for (const path of ${JSON.stringify(hidden)}) {
  try { fs.readFileSync(path); process.exit(1); }
  catch (e) { if (!["EACCES", "EPERM", "ENOENT"].includes(e.code)) throw e; }
}
console.log(${JSON.stringify(PROBE)});
`;
}

/**
 * The probe passes only when the harness itself reports the sandboxed probe output and a refused read of the login folder.
 * @param {string} stdout @param {string} configProbe
 */
function probePassed(stdout, configProbe) {
  /** @type {Map<string, {name: string, input: any}>} */
  const uses = new Map();
  let ranProbe = false, readRefused = false;
  for (const event of events(stdout)) {
    for (const item of contentOf(event)) {
      if (item.type === "tool_use") uses.set(item.id, item);
      if (item.type !== "tool_result") continue;
      const text = resultText(item.content);
      if (/Synthetic (host home )?probe/.test(text)) return false;
      const use = uses.get(item.tool_use_id);
      if (use?.name === "Bash" && use.input?.command === PROBE_COMMAND && !item.is_error && text.includes(PROBE)) ranProbe = true;
      if (use?.name === "Read" && use.input?.file_path === configProbe && item.is_error) readRefused = true;
    }
  }
  return ranProbe && readRefused;
}

/** @param {string} text @returns {any[]} */
function events(text) {
  return text.split("\n").flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

/** @param {any} event @returns {any[]} */
function contentOf(event) {
  return (event?.type === "assistant" || event?.type === "user") && Array.isArray(event.message?.content) ? event.message.content : [];
}

/** @param {unknown} content */
function resultText(content) {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map((part) => typeof part?.text === "string" ? part.text : "").join("\n") : "";
}

/**
 * The last message Claude delivered, not its reasoning or tool output.
 * @param {string} stdout
 */
function finalMessage(stdout) {
  let text = "", error = false;
  for (const event of events(stdout)) {
    if (event.type !== "result") continue;
    error = event.is_error === true || event.subtype !== "success";
    text = typeof event.result === "string" ? event.result : "";
  }
  return { text, error };
}
