// Shared pieces for the four self-journey replays. No model calls.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("..", import.meta.url));
const CACHE = "/tmp/jf-self";

/** @param {string} text */
export function plain(text) {
  return String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} heading
 * @param {string} body
 */
export async function show(page, heading, body) {
  const escape = (value) => plain(value).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]);
  await page.setContent(`<!doctype html><meta charset="utf-8"><title>${escape(heading)}</title>
<style>body{font:16px/1.45 system-ui,sans-serif;margin:24px;background:#fff;color:#111;max-width:880px}h1{font-size:20px;margin:0 0 12px}pre{white-space:pre-wrap;background:#f4f4f4;padding:12px;margin:0}</style>
<h1>${escape(heading)}</h1><pre>${escape(body)}</pre>`);
}

// Release 0.0.6. Its first run does not pass. origin/main now includes that fix, so packing main would not fail.
const BROKEN_MAIN = "0d564c6352762df628e70a4488f5a28e61e269a3";

/**
 * The broken build, as a ref this checkout can archive.
 * CI checks out only this branch, so fetch that one commit when it is missing.
 * @returns {string}
 */
function mainRef() {
  const present = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${BROKEN_MAIN}^{commit}`], { cwd: REPO });
  if (present.status === 0) return BROKEN_MAIN;
  const fetched = spawnSync("git", ["fetch", "--depth", "1", "origin", BROKEN_MAIN], { cwd: REPO, encoding: "utf8" });
  if (fetched.status !== 0) {
    throw new Error(fetched.stderr || "Could not fetch the broken build. The broken-build journeys compare against that commit.");
  }
  return BROKEN_MAIN;
}

/**
 * Pack this branch and main once. Later calls read the cache.
 * @returns {{branchTgz: string, mainTgz: string, mainTree: string, repo: string}}
 */
export function packs() {
  const file = join(CACHE, "packs.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  mkdirSync(CACHE, { recursive: true });
  const branchTgz = packCore(join(REPO, "packages/core"), join(CACHE, "branch.tgz"));
  const mainTree = join(CACHE, "main");
  mkdirSync(mainTree, { recursive: true });
  const archived = spawnSync("git", ["archive", mainRef()], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
  if (archived.status !== 0) throw new Error(archived.stderr?.toString() || "git archive of main failed");
  const extracted = spawnSync("tar", ["-x", "-C", mainTree], { input: archived.stdout });
  if (extracted.status !== 0) throw new Error(extracted.stderr?.toString() || "tar failed");
  const mainTgz = packCore(join(mainTree, "packages/core"), join(CACHE, "main.tgz"));
  const saved = { branchTgz, mainTgz, mainTree, repo: REPO };
  writeFileSync(file, JSON.stringify(saved));
  return saved;
}

/** @param {string} coreDir @param {string} dest */
function packCore(coreDir, dest) {
  const result = spawnSync("npm", ["pack", "--pack-destination", CACHE], { cwd: coreDir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  const name = result.stdout.trim().split("\n").pop();
  const packed = join(CACHE, /** @type {string} */ (name));
  if (packed !== dest) writeFileSync(dest, readFileSync(packed));
  return dest;
}

/**
 * @param {string} cwd
 * @param {string} cmd
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
export function run(cwd, cmd, args, env = {}) {
  const childEnv = { ...process.env, CI: "1", ...env };
  delete childEnv.FORCE_COLOR;
  delete childEnv.NO_COLOR;
  delete childEnv.JF_BROKEN;
  const started = Date.now();
  const result = spawnSync(cmd, args, { cwd, env: childEnv, encoding: "utf8", timeout: 180_000 });
  return { status: result.status, output: plain(`${result.stdout ?? ""}${result.stderr ?? ""}`), ms: Date.now() - started };
}

/** Install a packed tarball into a fresh project. @param {string} tarball */
export function install(tarball) {
  const dir = mkdtempSync(join(tmpdir(), "jf-app-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", private: true, type: "module" }));
  const version = JSON.parse(readFileSync(join(REPO, "node_modules/@playwright/test/package.json"), "utf8")).version;
  // The same Playwright the repo already installed, so the run uses the browser that is already on disk.
  const result = run(dir, "npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", tarball, `@playwright/test@${version}`]);
  if (result.status !== 0) throw new Error(result.output);
  return dir;
}

/** A project whose node_modules points at a journeysfirst package directory. @param {string} coreDir */
export function linkProject(coreDir) {
  const dir = mkdtempSync(join(tmpdir(), "jf-link-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", private: true, type: "module" }));
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  symlinkSync(coreDir, join(dir, "node_modules/journeysfirst"));
  symlinkSync(join(REPO, "node_modules/@playwright"), join(dir, "node_modules/@playwright"));
  return dir;
}

/** @param {string} dir */
export function binOf(dir) {
  return join(dir, "node_modules/journeysfirst/bin/journeysfirst.js");
}

/** @param {string} dir */
export function playwrightOf(dir) {
  const local = join(dir, "node_modules/@playwright/test/cli.js");
  return existsSync(local) ? local : join(REPO, "node_modules/@playwright/test/cli.js");
}

/** @returns {string} */
export function freePort() {
  return String(20000 + Math.floor(Math.random() * 20000));
}

/**
 * @param {string} dir
 * @param {string} name journey folder name
 */
export function newestRun(dir, name) {
  const folder = join(dir, "journey-runs", name);
  if (!existsSync(folder)) return null;
  const ids = readdirSync(folder).filter((id) => existsSync(join(folder, id, "run.json")));
  ids.sort((a, b) => statSync(join(folder, a, "run.json")).mtimeMs - statSync(join(folder, b, "run.json")).mtimeMs);
  return ids.length ? join(folder, ids.at(-1)) : null;
}

/** @param {string} name @param {number} ms */
export function markTime(name, ms) {
  mkdirSync(CACHE, { recursive: true });
  appendFileSync(join(CACHE, "times.log"), `${name} ${ms}\n`);
  console.log(`wall_ms ${name} ${ms}`);
}

/**
 * Find `npx journeysfirst init` by reading only the given roots.
 * @param {string[]} roots
 * @returns {{command: string|null, from: string, files: string[]}}
 */
export function discoverInit(roots) {
  /** @type {string[]} */
  const files = [];
  const look = [
    "README.md",
    "skills",
    "docs",
    "spec",
    "packages/core/bin/journeysfirst.js",
    "node_modules/journeysfirst/skills",
    "node_modules/journeysfirst/docs",
    "node_modules/journeysfirst/spec",
    "node_modules/journeysfirst/README.md",
  ];
  for (const root of roots) {
    for (const rel of look) {
      const hit = findLine(join(root, rel), /npx journeysfirst init\b/, files);
      if (hit) return { command: "npx journeysfirst init", from: hit, files };
    }
  }
  return { command: null, from: "", files };
}

/**
 * @param {string} target
 * @param {RegExp} pattern
 * @param {string[]} files
 * @returns {string | null}
 */
function findLine(target, pattern, files) {
  if (!existsSync(target)) return null;
  if (statSync(target).isFile()) return scanFile(target, pattern, files);
  return walk(target, pattern, files);
}

/** @param {string} dir @param {RegExp} pattern @param {string[]} files */
function walk(dir, pattern, files) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      const hit = walk(path, pattern, files);
      if (hit) return hit;
    } else if (/\.(md|js|yaml|yml)$/.test(name)) {
      const hit = scanFile(path, pattern, files);
      if (hit) return hit;
    }
  }
  return null;
}

/** @param {string} path @param {RegExp} pattern @param {string[]} files */
function scanFile(path, pattern, files) {
  files.push(path);
  return pattern.test(readFileSync(path, "utf8")) ? path : null;
}

/**
 * @param {string} folder
 * @returns {string[]} paths that are outside the allowed roots
 */
export function outside(files, roots) {
  return files.filter((file) => !roots.some((root) => file === root || file.startsWith(root.endsWith("/") ? root : `${root}/`)));
}
