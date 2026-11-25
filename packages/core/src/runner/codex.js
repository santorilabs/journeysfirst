import { accessSync, chmodSync, closeSync, constants, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { RunRecorder, recording } from "./recorder.js";
import { agentPrompt, importResults, prepareProject, processResult, readSmall } from "./agent.js";
import { maskText } from "./mask.js";

const PROFILE = "journeysfirst";
const PROBE = "journeysfirst: workspace readable, auth directory denied";

/**
 * Launch Codex with a fresh project and a separately protected provider login.
 * @param {{journey: string, caseId?: string, project?: string, mcp?: Record<string, string[]>, container?: string, allowHostRead?: boolean, timeoutMs?: number, agentArgs: string[]}} options
 */
export async function runCodex({ journey, caseId, project, mcp, container, allowHostRead = false, timeoutMs = 180000, agentArgs }) {
  const selected = pickArgs(agentArgs);
  const run = RunRecorder.start({ journey, case: caseId, ranBy: { agent: "codex" }, playedBy: { you: "Codex" } });
  if (run.plan.everyone.some((user) => user !== "you")) {
    throw new Error("The Codex launcher only plays the 'you' seat. Use the recorder directly for journeys with more than one user.");
  }
  const key = process.env.OPENAI_API_KEY;
  const loginFile = codexLoginFile();
  if (!key && !loginFile) throw new Error("No Codex login found. Run `codex login`.");
  if (key) run.value("OPENAI_API_KEY", key, { secret: true });
  const base = realpathSync(mkdtempSync(join(tmpdir(), "journeysfirst-codex-")));
  const work = join(base, "work"), home = join(base, "home"), auth = join(base, "codex");
  const state = join(work, ".journeysfirst");
  const authFile = join(auth, "auth.json");
  const runtime = container ? undefined : codexExecutable();
  const node = container ? "node" : realpathSync(process.execPath);
  const interrupt = new AbortController();
  /** @type {number | undefined} */
  let signalExit;
  const onInt = () => { signalExit ??= 130; interrupt.abort(); };
  const onTerm = () => { signalExit ??= 143; interrupt.abort(); };
  const launcher = launcherFor({ base, work, home, auth, container, runtime, node, signal: interrupt.signal });
  let problem;
  let probeDir;
  /** @type {Buffer | undefined} */
  let reusedLogin;
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  try {
    prepareProject(project, base, work, loginFile);
    mkdirSync(home);
    mkdirSync(auth);
    const hostHome = !container && !allowHostRead ? realpathSync(homedir()) : undefined;
    const permissions = sandboxArgs({ work, home, auth, container, hostHome, loginFile, runtime, node });
    const sandbox = ["sandbox", "-P", PROFILE, ...permissions];
    writeFileSync(authFile, "Synthetic probe. No login is in this file.\n");
    const checked = await launcher([...sandbox, "--", node, "-e", probeCode(), work, authFile, String(process.pid)], "", 15000);
    rmSync(authFile, { force: true });
    if (checked.code !== 0 || checked.stdout.trim() !== PROBE) {
      throw new Error("Codex failed the scratch login probe: the sandbox must start Node, read the scratch project and deny the provider login. Check your Node and Codex installs, or use a compatible container.");
    }
    if (hostHome) {
      probeDir = mkdtempSync(join(hostHome, ".journeysfirst-probe-"));
      const canary = join(probeDir, "host.txt");
      writeFileSync(canary, "Synthetic host home probe.\n");
      const homeCheck = await launcher([...sandbox, "--", node, "-e", probeCode(), work, canary, String(process.pid)], "", 15000);
      if (homeCheck.code !== 0 || homeCheck.stdout.trim() !== PROBE) {
        throw new Error("Codex could not prove that its sandbox blocks your home directory. Use a container or explicitly pass --allow-host-read.");
      }
    }
    if (loginFile && !container) {
      const original = await launcher([...sandbox, "--", node, "-e", probeCode(), work, loginFile, String(process.pid)], "", 15000);
      if (original.code !== 0 || original.stdout.trim() !== PROBE) {
        throw new Error("Codex could not prove that its sandbox blocks the existing login file. Use a compatible container.");
      }
    }
    if (key) {
      const login = await launcher(["login", "--with-api-key"], key + "\n", 15000);
      if (login.code !== 0) throw new Error("Codex could not sign in with OPENAI_API_KEY. Check that the provider key is valid.");
    } else if (loginFile) {
      try {
        reusedLogin = readFileSync(loginFile);
        writeFileSync(authFile, reusedLogin, { mode: 0o600, flag: "wx" });
      } catch {
        throw new Error("Could not reuse the Codex login. Run `codex login`.");
      }
    }
    const servers = mcpConfig(mcp ?? {}, sandbox, state, work, runtime ?? "codex", node);
    const prompt = agentPrompt(run);
    const result = await launcher(["-a", "never", ...permissions, ...servers.args, "exec", "--json", "--ephemeral",
      "--skip-git-repo-check", ...selected, "-"], prompt, timeoutMs);
    const seat = recording(run, "you");
    const importErrors = importResults(seat, state);
    if (importErrors.length) run.tag("result_import_errors", importErrors.map((error) => maskText(run.redact(error))));
    const final = finalMessage(result.stdout);
    if (result.timedOut) problem = "Codex reached the time limit.";
    else if (result.code !== 0) problem = "Codex exited before completing the journey.";
    const failedServers = servers.names.flatMap((name) => {
      const code = readSmall(join(state, name + ".txt.exit"));
      return /^[1-9]\d{0,2}$/.test(code) ? [{ server: maskText(run.redact(name)), code: Number(code), cause: "environment" }] : [];
    });
    if (failedServers.length) {
      run.tag("mcp_server_failures", failedServers);
      problem = [problem, ...failedServers.map(({ server, code }) => `MCP server "${server}" exited with status ${code}.`)].filter(Boolean).join(" ");
    }
    if (final) run.attach({ name: "handoff.txt", body: maskText(run.redact(final)), kind: "transcript" });
  } catch (error) {
    problem = run.redact(error instanceof Error ? error.message : "Codex could not complete the journey.");
  } finally {
    if (signalExit) problem = `Codex was interrupted (${signalExit === 130 ? "SIGINT" : "SIGTERM"}).`;
    try {
      if (loginFile && reusedLogin) saveRefreshedLogin(loginFile, authFile, reusedLogin);
    } catch {
      problem = [problem, "Could not save the refreshed Codex login. Run `codex login`."].filter(Boolean).join(" ");
    } finally {
      process.removeListener("SIGINT", onInt);
      process.removeListener("SIGTERM", onTerm);
      if (probeDir) rmSync(probeDir, { recursive: true, force: true });
      rmSync(base, { recursive: true, force: true });
    }
  }
  const saved = run.finish(problem ? { attempt: { status: "aborted", reason: problem } } : undefined);
  return { ...saved, problem, exitCode: signalExit ?? (problem ? 1 : 0) };
}

export const codex = {
  name: "codex",
  setup: "Install the Codex CLI and run `codex login`.",
  /** @param {string} [container] */
  detect: (container) => Boolean(container || codexExecutable()),
  authProbe: () => Boolean(process.env.OPENAI_API_KEY || codexLoginFile()),
  sandboxArgs,
  mcpConfig,
  start: runCodex,
};

/** @param {string[]} args */
function pickArgs(args) {
  if (args.length > 2 || (args.length && (args.length !== 2 || !["--model", "-m"].includes(args[0]) || !/^[\w.-]+$/.test(args[1])))) {
    throw new Error("Pass only --model <name> after --. Journeys First sets the Codex prompt and sandbox.");
  }
  return args;
}

/** @param {{base: string, work: string, home: string, auth: string, container?: string, runtime?: string, node: string, signal: AbortSignal}} options */
function launcherFor({ base, work, home, auth, container, runtime, node, signal }) {
  const env = {
    PATH: container ? "/usr/local/bin:/usr/bin:/bin" : [dirname(node), ...(process.env.PATH ?? "").split(":")].join(":"),
    HOME: home, CODEX_HOME: auth, LANG: "C.UTF-8",
  };
  /** @param {string[]} args @param {string} stdin @param {number} timeout */
  return async (args, stdin, timeout) => {
    if (!container) return processResult(runtime ?? "codex", args, { cwd: work, env, stdin, timeout, signal });
    if (!/^[\w][\w./:@-]*$/.test(container)) throw new Error("Give a local container image name.");
    const name = basename(base);
    try {
      return await processResult("docker", ["run", "--pull", "never", "--rm", "--init", "-i", "--name", name,
        "--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        "--mount", `type=bind,src=${base},dst=${base}`, "--workdir", work,
        ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]), container, "codex", ...args], { cwd: work, stdin, timeout, signal });
    } finally {
      await processResult("docker", ["rm", "-f", name], { cwd: work, stdin: "", timeout: 10000 });
    }
  };
}

/** @param {{work: string, home: string, auth: string, container?: string, hostHome?: string, loginFile?: string, runtime?: string, node: string}} path */
function sandboxArgs({ work, home, auth, container, hostHome, loginFile, runtime, node }) {
  /** @type {Record<string, string>} */
  const paths = { [hostHome ? ":minimal" : ":root"]: "read", "/proc": "deny", [work]: "write", [home]: "write", [auth]: "deny" };
  if (hostHome) {
    const runtimes = [node, ...(runtime ? codexRuntimePaths(runtime) : [])];
    for (const path of runtimes) paths[path] = "read";
    for (const resolver of resolverFiles([hostHome, auth, "/proc"])) paths[resolver] ??= "read";
    if (!runtimes.some((path) => path.startsWith(hostHome + "/"))) paths[hostHome] = "deny";
  } else if (!container) {
    for (const name of [".aws", ".codex", ".config", ".docker", ".gitconfig", ".kube", ".netrc", ".npmrc", ".ssh"]) {
      paths[join(homedir(), name)] = "deny";
    }
  }
  if (loginFile && !container &&
      !Object.entries(paths).some(([path, mode]) => mode === "deny" && loginFile.startsWith(path + "/"))) {
    paths[loginFile] = "deny";
  }
  const fs = Object.entries(paths).map(([name, mode]) => `${JSON.stringify(name)}=${JSON.stringify(mode)}`).join(",");
  return ["-c", `default_permissions="${PROFILE}"`, "-c", `permissions.${PROFILE}.filesystem={${fs}}`,
    "-c", `permissions.${PROFILE}.network.enabled=true`, "-c", 'shell_environment_policy.inherit="none"',
    "-c", `shell_environment_policy.set={HOME=${JSON.stringify(home)},PATH=${JSON.stringify(container ? "/usr/local/bin:/usr/bin:/bin" : dirname(node) + ":/usr/local/bin:/usr/bin:/bin")}}`];
}

/** @param {string[]} denied */
function resolverFiles(denied) {
  const seen = new Set(["/etc/resolv.conf"]);
  const files = new Set();
  try {
    let path = "/etc/resolv.conf";
    for (let hops = 0; hops < 40; hops++) {
      if (denied.some(root => path === root || path.startsWith(root + "/"))) break;
      const parts = path.slice(1).split("/");
      let prefix = "";
      for (const [i, part] of parts.entries()) {
        prefix += "/" + part;
        const entry = lstatSync(prefix);
        const leaf = i === parts.length - 1;
        if (entry.isSymbolicLink()) {
          if (leaf && path !== "/etc/resolv.conf") files.add(path);
          path = resolve(dirname(prefix), readlinkSync(prefix), ...parts.slice(i + 1));
          break;
        }
        if (leaf) {
          if (!entry.isFile()) return [];
          if (path !== "/etc/resolv.conf") files.add(path);
          return [...files];
        }
      }
      if (seen.has(path)) break;
      seen.add(path);
    }
  } catch {}
  return [];
}

function codexLoginFile() {
  try {
    const file = realpathSync(join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json"));
    const entry = statSync(file);
    if (entry.isFile() && entry.size > 0) {
      accessSync(file, constants.R_OK);
      return file;
    }
  } catch {}
}

/** @param {Buffer} content */
function chatgptAccount(content) {
  try {
    const { auth_mode: mode, tokens } = JSON.parse(content.toString("utf8"));
    if (mode !== undefined && mode !== "chatgpt") return undefined;
    if (["account_id", "id_token", "access_token", "refresh_token"].every(name => typeof tokens?.[name] === "string" && tokens[name].trim())) {
      return tokens.account_id;
    }
  } catch {}
}

/** @param {string} original @param {string} scratch @param {Buffer} before */
function saveRefreshedLogin(original, scratch, before) {
  const account = chatgptAccount(before);
  if (!account) return;
  /** @type {Buffer} */
  let refreshed;
  try {
    refreshed = readFileSync(scratch, { flag: constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return;
    throw error;
  }
  if (before.equals(refreshed) || chatgptAccount(refreshed) !== account) return;
  const staged = mkdtempSync(join(dirname(original), ".journeysfirst-login-"));
  try {
    const file = join(staged, "auth.json");
    writeFileSync(file, refreshed, { mode: 0o600, flag: "wx" });
    if (realpathSync(original) !== original || !before.equals(readFileSync(original))) return;
    chmodSync(file, statSync(original).mode & 0o777);
    renameSync(file, original);
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}
function codexExecutable() {
  for (const path of (process.env.PATH ?? "").split(":")) {
    if (!isAbsolute(path)) continue;
    try {
      const executable = realpathSync(join(path, "codex"));
      accessSync(executable, constants.X_OK);
      if (statSync(executable).isFile()) return executable;
    } catch {}
  }
}

/** @param {string} executable */
function codexRuntimePaths(executable) {
  const pkg = dirname(dirname(executable));
  if (basename(pkg) !== "codex" || basename(dirname(pkg)) !== "@openai") return [executable];
  const platform = process.platform;
  const native = join(dirname(pkg), `codex-${platform}-${process.arch}`);
  return existsDirectory(native) ? [pkg, native] : [pkg];
}

/** @param {string} path */
function existsDirectory(path) {
  try { return lstatSync(path).isDirectory(); } catch { return false; }
}

function probeCode() {
  return `const fs=require("node:fs");
    fs.readdirSync(process.argv[1]);
    const outer = "/proc/" + process.argv[3];
    for (const path of [process.argv[2], outer + "/environ", outer + "/root" + process.argv[2]]) {
      try { fs.readFileSync(path); process.exit(1); }
      catch(e) { if (!["EACCES","EPERM","ENOENT"].includes(e.code)) throw e; }
    }
    console.log(${JSON.stringify(PROBE)});`;
}

/** @param {Record<string,string[]>} config @param {string[]} sandbox @param {string} state @param {string} work @param {string} runtime @param {string} node */
function mcpConfig(config, sandbox, state, work, runtime, node) {
  const args = Object.entries(config).flatMap(([name, argv]) => {
    const args = [...sandbox, "--", node, join(state, "capture.mjs"), "mcp-proxy", name + ".txt", "--", ...argv];
    const prefix = `mcp_servers.${name}`;
    return ["-c", `${prefix}.command=${JSON.stringify(runtime)}`, "-c", `${prefix}.args=${JSON.stringify(args)}`,
      "-c", `${prefix}.cwd=${JSON.stringify(work)}`, "-c", `${prefix}.default_tools_approval_mode="approve"`];
  });
  return { args, names: Object.keys(config) };
}

/** @param {string} text */
function finalMessage(text) {
  let final = "";
  for (const line of text.split("\n")) {
    try {
      const event = JSON.parse(line);
      if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
        final = event.item.text;
      }
    } catch {}
  }
  return final;
}
