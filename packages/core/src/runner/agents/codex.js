import { accessSync, chmodSync, closeSync, constants, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { processResult, readSmall, warnIfMissingMcp, withAgentRun } from "../agent.js";
import { maskText } from "../mask.js";

const PROFILE = "journeysfirst";
const PROBE = "journeysfirst: workspace readable, auth directory denied";
const WORKSPACE_DENIED = "journeysfirst: workspace not readable";
const PROTECTED_READABLE = "journeysfirst: protected file readable";

/** @param {import("../agent.js").AdapterOptions} options */
async function start({ mcp = {}, mcpOverride, container, allowHostRead = false, timeoutMs = 180000, agentArgs, ...options }) {
  const selected = pickArgs(agentArgs);
  const key = process.env.OPENAI_API_KEY;
  const loginFile = codexLoginFile();
  if (!key && !loginFile) throw new Error("No Codex login found. Run `codex login`.");
  const runtime = container ? undefined : codexExecutable();
  const node = container ? "node" : realpathSync(process.execPath);
  return withAgentRun({ ...options, agent: "codex", label: "Codex", loginFile }, async ({ base, work, state, run, signal, prompt }) => {
    if (key) run.value("OPENAI_API_KEY", key, { secret: true });
    const home = join(base, "home"), auth = join(base, "codex");
    const authFile = join(auth, "auth.json");
    const launcher = launcherFor({ base, work, home, auth, container, runtime, node, signal });
    let probeDir;
    /** @type {Buffer | undefined} */
    let reusedLogin;
    let problem;
    let handoff;
    try {
      mkdirSync(home);
      mkdirSync(auth);
      const hostHome = !container && !allowHostRead ? realpathSync(homedir()) : undefined;
      const permissions = sandboxArgs({ work, home, auth, container, hostHome, loginFile, runtime, node });
      const sandbox = ["sandbox", "-P", PROFILE, ...permissions];
      writeFileSync(authFile, "Synthetic probe. No login is in this file.\n");
      const checked = await launcher([...sandbox, "--", node, "-e", probeCode(), work, authFile, String(process.pid)], "", 15000);
      rmSync(authFile, { force: true });
      if (checked.code !== 0 || checked.stdout.trim() !== PROBE) {
        throw new Error(`Codex failed the scratch login probe: ${scratchProbeError(checked)}`);
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
      const native = mcpOverride ? [] : nativeMcpServers(mcp);
      const config = { ...Object.fromEntries(native.map(({ name, argv }) => [name, argv])), ...mcp };
      const envNames = Object.fromEntries(native.map(({ name, envNames }) => [name, envNames]));
      const servers = mcpConfig(config, sandbox, state, work, runtime ?? "codex", node, envNames);
      warnIfMissingMcp(run, servers.names);
      const serverEnv = Object.fromEntries(Object.values(envNames).flat().flatMap((name) => {
        const value = process.env[name];
        if (value && value.length >= 8) run.value(`JF_MCP_ENV_${name}`, value, { secret: true });
        return value === undefined ? [] : [[`JF_MCP_ENV_${name}`, value]];
      }));
      const result = await launcher(["-a", "never", ...permissions, ...servers.args, "exec", "--json", "--ephemeral",
        "--skip-git-repo-check", ...selected, "-"], prompt, timeoutMs, serverEnv);
      handoff = finalMessage(result.stdout);
      if (result.timedOut) problem = "Codex reached the time limit.";
      else if (result.code !== 0) problem = "Codex exited before completing the journey.";
      const failedServers = realpathSync(state) === state ? servers.names.flatMap((name) => {
        const code = readSmall(join(state, name + ".txt.exit"));
        return /^[1-9]\d{0,2}$/.test(code) ? [{ server: name, code: Number(code), cause: "environment" }] : [];
      }) : [];
      if (failedServers.length) {
        run.tag("mcp_server_failures", failedServers.map((failure) => ({ ...failure, server: maskText(run.redact(failure.server)) })));
        const messages = failedServers.map(({ server, code }) => {
          const diagnostic = readSmall(join(state, server + ".txt.stderr"));
          const safeServer = maskText(run.redact(server));
          const name = `${safeServer}-stderr.txt`;
          if (diagnostic) run.attach({ name, body: maskText(run.redact(diagnostic)), kind: "transcript" });
          const detail = diagnostic ? ` See ${name} in the saved run.` : "";
          return `MCP server "${safeServer}" exited with status ${code}.${detail} ${mcpFailureHint(diagnostic)}`;
        });
        problem = [problem, ...messages].filter(Boolean).join(" ");
      }
    } catch (error) {
      problem = run.redact(error instanceof Error ? error.message : "Codex could not complete the journey.");
    } finally {
      try {
        if (loginFile && reusedLogin) saveRefreshedLogin(loginFile, authFile, reusedLogin);
      } catch {
        problem = [problem, "Could not save the refreshed Codex login. Run `codex login`."].filter(Boolean).join(" ");
      } finally {
        if (probeDir) rmSync(probeDir, { recursive: true, force: true });
      }
    }
    return { problem, handoff };
  });
}

/** @param {string} diagnostic */
function mcpFailureHint(diagnostic) {
  if (/could not start the command|failed to exec|ENOENT|command not found|cannot find module/i.test(diagnostic)) {
    return "The command or a dependency was not available. Try the command in the test project and use a sandbox-readable install.";
  }
  if (/permission denied|EACCES|EPERM|read-only file system/i.test(diagnostic)) {
    return "The server could not access a required path. Move its files into the test project or use a compatible container. Only try --allow-host-read if you trust the project and server with access to host files.";
  }
  return "Run the configured command in the test project to check how it starts. Use a sandbox-readable install or a compatible container.";
}

/** @type {import("../agent.js").AgentAdapter} */
export const codex = {
  name: "codex",
  setup: "Install the Codex CLI and run `codex login`.",
  detect: (container) => Boolean(container || codexExecutable()),
  authProbe: () => Boolean(process.env.OPENAI_API_KEY || codexLoginFile()),
  sandboxArgs,
  mcpConfig,
  start,
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
  /** @param {string[]} args @param {string} stdin @param {number} timeout @param {Record<string,string>} [serverEnv] */
  return async (args, stdin, timeout, serverEnv = {}) => {
    if (!container) return processResult(runtime ?? "codex", args, { cwd: work, env: { ...env, ...serverEnv }, stdin, timeout, signal });
    if (!/^[\w][\w./:@-]*$/.test(container)) throw new Error("Give a local container image name.");
    const name = basename(base);
    try {
      return await processResult("docker", ["run", "--pull", "never", "--rm", "--init", "-i", "--name", name,
        "--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        "--mount", `type=bind,src=${base},dst=${base}`, "--workdir", work,
        ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
        ...Object.keys(serverEnv).flatMap((name) => ["--env", name]), container, "codex", ...args],
      { cwd: work, env: { ...process.env, ...serverEnv }, stdin, timeout, signal });
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
    const runtimes = [...nodeRuntimePaths(node), ...(runtime ? codexRuntimePaths(runtime) : [])];
    for (const path of runtimes) paths[path] = "read";
    const resolvers = resolverPaths([hostHome, auth, "/proc"]);
    for (const path of resolvers.files) paths[path] ??= "read";
    for (const path of resolvers.siblings) paths[path] ??= "deny";
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
function resolverPaths(denied) {
  const seen = new Set(["/etc/resolv.conf"]);
  const files = new Set();
  const keep = new Set(seen);
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
          keep.add(prefix);
          if (leaf && path !== "/etc/resolv.conf") files.add(path);
          path = resolve(dirname(prefix), readlinkSync(prefix), ...parts.slice(i + 1));
          break;
        }
        if (leaf) {
          if (!entry.isFile()) break;
          if (path !== "/etc/resolv.conf") files.add(path);
          keep.add(path);
          const directories = new Set([...keep].map((file) => dirname(file)).filter((folder) => /^\/(etc|run)\//.test(folder)));
          const siblings = [...directories].flatMap((folder) => {
            try {
              return readdirSync(folder).map((name) => join(folder, name))
                .filter((path) => ![...keep].some((needed) => needed === path || needed.startsWith(path + "/")));
            } catch { return []; }
          });
          return { files, siblings };
        }
      }
      if (seen.has(path)) break;
      seen.add(path);
    }
  } catch {}
  return { files: [], siblings: [] };
}

function codexLoginFile() {
  try {
    const file = realpathSync(join(codexHome(), "auth.json"));
    const entry = statSync(file);
    if (entry.isFile() && entry.size > 0) {
      accessSync(file, constants.R_OK);
      return file;
    }
  } catch {}
}

function codexHome() {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
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

/** @param {string} node */
function nodeRuntimePaths(node) {
  const bin = dirname(node);
  const npm = resolve(bin, "../lib/node_modules/npm");
  const paths = [node];
  try {
    const packageDir = realpathSync(npm);
    if (packageDir !== npm || !statSync(packageDir).isDirectory()) return paths;
    for (const tool of ["npm", "npx"]) {
      const executable = join(bin, tool);
      try {
        const target = realpathSync(executable);
        if (target.startsWith(packageDir + "/") && statSync(target).isFile()) return [bin, packageDir];
      } catch {}
    }
  } catch {}
  return paths;
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
    try { fs.readdirSync(process.argv[1]); }
    catch { console.log(${JSON.stringify(WORKSPACE_DENIED)}); process.exit(1); }
    const outer = "/proc/" + process.argv[3];
    for (const path of [process.argv[2], outer + "/environ", outer + "/root" + process.argv[2]]) {
      try { fs.readFileSync(path); console.log(${JSON.stringify(PROTECTED_READABLE)}); process.exit(1); }
      catch(e) { if (!["EACCES","EPERM","ENOENT"].includes(e.code)) throw e; }
    }
    console.log(${JSON.stringify(PROBE)});`;
}

/** @param {Awaited<ReturnType<typeof processResult>>} probe */
function scratchProbeError({ stdout, stderr, timedOut }) {
  if (timedOut) return "the sandbox did not start in time. Try a regular host terminal or a compatible container.";
  if (stdout.trim() === PROTECTED_READABLE) return "a protected file was readable. No login was copied. Use a compatible container.";
  if (stdout.trim() === WORKSPACE_DENIED) return "Node could not read the scratch project. Set TMPDIR to a writable host folder outside the project.";
  if (/namespace|operation not permitted|bwrap|bubblewrap/i.test(stderr)) return "the sandbox could not start. If you are inside another sandbox, run from a regular host terminal or use a compatible container.";
  if (/failed to exec|no such file or directory/i.test(stderr)) return "the sandbox could not start Node. Check that the Node executable is available to Codex, or use a compatible container.";
  return "the sandbox did not return a result. Run from a regular host terminal and check that Codex can start its Linux sandbox, or use a compatible container.";
}

/** @param {Record<string,string[]>} config @param {string[]} sandbox @param {string} state @param {string} work @param {string} runtime @param {string} node @param {Record<string,string[]>} [envByServer] */
function mcpConfig(config, sandbox, state, work, runtime, node, envByServer = {}) {
  const args = Object.entries(config).flatMap(([name, argv]) => {
    const envNames = Object.hasOwn(envByServer, name) ? envByServer[name] : [];
    const forwarded = envNames.map((name) => `JF_MCP_ENV_${name}`);
    const policy = forwarded.length ? [...sandbox, "-c", 'shell_environment_policy.inherit="all"',
      "-c", `shell_environment_policy.include_only=${JSON.stringify(["PATH", "HOME", "LANG", ...forwarded])}`] : sandbox;
    const passEnv = envNames.length ? ["--env-vars", envNames.join(",")] : [];
    const args = [...policy, "--", node, join(state, "capture.mjs"), "mcp-proxy", name + ".txt", ...passEnv, "--", ...argv];
    const prefix = `mcp_servers.${name}`;
    return ["-c", `${prefix}.command=${JSON.stringify(runtime)}`, "-c", `${prefix}.args=${JSON.stringify(args)}`,
      "-c", `${prefix}.cwd=${JSON.stringify(work)}`, "-c", `${prefix}.default_tools_approval_mode="approve"`,
      ...(forwarded.length ? ["-c", `${prefix}.env_vars=${JSON.stringify(forwarded)}`] : [])];
  });
  return { args, names: Object.keys(config) };
}

/** @param {Record<string,string[]>} project */
function nativeMcpServers(project) {
  let source;
  try {
    source = readFileSync(join(codexHome(), "config.toml"), "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return [];
    throw new Error("Could not read the agent's MCP config. Check config.toml or pass --mcp to override it.");
  }
  const tables = new Map();
  let table, pending;
  for (const raw of source.split(/\r?\n/)) {
    const line = tomlCode(raw).trim();
    if (!line) continue;
    if (pending) {
      table.set(pending, table.get(pending) + " " + line);
      if (line.endsWith("]")) pending = undefined;
      continue;
    }
    if (line.startsWith("[")) {
      const header = /^\[mcp_servers\.(?:([\w-]+)|"([\w-]+)"|'([\w-]+)')(\.[^\]]+)?\]$/.exec(line);
      const name = header?.slice(1, 4).find(Boolean);
      table = undefined;
      if (!name || !/^[A-Za-z0-9][\w-]*$/.test(name) || Object.hasOwn(project, name)) continue;
      const entries = tables.get(name) ?? new Map();
      tables.set(name, entries);
      if (header?.[4]) entries.set("nested", true);
      else table = entries;
      continue;
    }
    const assignment = TOML_ASSIGNMENT.exec(line);
    if (!table || !assignment) continue;
    const [, writtenKey, value] = assignment;
    let key;
    try {
      key = /^[\w-]+$/.test(writtenKey) ? writtenKey : tomlString(writtenKey);
    } catch {
      table.set("nested", true);
      continue;
    }
    if (!["command", "args", "enabled", "url", "env_vars", "env", "enabled_tools", "disabled_tools"].includes(key)) continue;
    table.set(key, value);
    if (value.startsWith("[") && !value.endsWith("]")) pending = key;
  }
  return [...tables].flatMap(([name, values]) => {
    if (values.has("url") || values.get("enabled") === "false" || !values.has("command")) return [];
    if (["env", "enabled_tools", "disabled_tools", "nested"].some((key) => values.has(key))) {
      console.error(`Skipping MCP server "${name}": it uses inline environment values or tool restrictions that Journeys First does not copy. Use env_vars for named variables, or pass --mcp with only the trusted test servers you want.`);
      return [];
    }
    try {
      const command = tomlString(values.get("command"));
      const args = values.has("args") ? tomlStringArray(values.get("args")) : [];
      const envNames = values.has("env_vars") ? tomlStringArray(values.get("env_vars")) : [];
      if (!command || !envNames.every((key) => /^[A-Z_][A-Z0-9_]*$/.test(key) && !["PATH", "HOME", "CODEX_HOME"].includes(key) && !key.startsWith("JF_MCP_ENV_"))) throw new Error();
      return [{ name, argv: [command, ...args], envNames: [...new Set(envNames)] }];
    } catch {
      console.error(`Skipping MCP server "${name}": check command, args and env_vars in config.toml, or pass --mcp to override it.`);
      return [];
    }
  });
}

const TOML_STRING = /"(?:[^"\\]|\\.)*"|'[^']*'/g;
const TOML_ASSIGNMENT = new RegExp("^(" + TOML_STRING.source + "|[\\w-]+)\\s*=\\s*(.*)$");

/** @param {string} line */
function tomlCode(line) {
  return line.replace(new RegExp(TOML_STRING.source + "|#.*", "g"), (part) => part.startsWith("#") ? "" : part);
}

/** @param {string} value */
function tomlString(value) {
  if (!new RegExp("^(?:" + TOML_STRING.source + ")$").test(value)) throw new Error();
  return value.startsWith("'") ? value.slice(1, -1) : JSON.parse(value);
}

/** @param {string} value */
function tomlStringArray(value) {
  const strings = [...value.matchAll(TOML_STRING)].map(([entry]) => tomlString(entry));
  if (!/^\[\s*(?:s\s*(?:,\s*s\s*)*,?\s*)?\]$/.test(value.replace(TOML_STRING, "s"))) throw new Error();
  return strings;
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
