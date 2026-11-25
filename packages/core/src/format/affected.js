// Which journeys to run again when files change.
// The map is journeys/covered-by.yaml, not a field on the journey. The journey
// stays plain sentences. A journey with no entry is not selected.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

/**
 * @param {string} root repo root
 * @param {string[]} paths paths that changed, from the repo root
 * @returns {{selected: string[], skipped: string[]}} journey files, relative to root
 */
export function affectedJourneys(root, paths) {
  const journeysDir = join(root, "journeys");
  if (!existsSync(journeysDir)) return { selected: [], skipped: [] };
  const map = readCoveredBy(root);
  const files = readdirSync(journeysDir)
    .filter((name) => name.endsWith(".journey.yaml") || name.endsWith(".journey.yml"))
    .sort();
  /** @type {string[]} */
  const selected = [];
  /** @type {string[]} */
  const skipped = [];
  for (const name of files) {
    const rel = `journeys/${name}`;
    const key = name.replace(/\.journey\.ya?ml$/, "");
    const covers = map.get(key) ?? [];
    const hit = covers.some((pattern) => paths.some((file) => pathCovers(pattern, file)));
    (hit ? selected : skipped).push(rel);
  }
  return { selected, skipped };
}

/**
 * One line per journey: `run <file>` or `skip <file>`.
 * @param {string} root
 * @param {string[]} paths
 * @returns {string[]}
 */
export function affectedLines(root, paths) {
  const { selected, skipped } = affectedJourneys(root, paths);
  return [...selected.map((file) => `run ${file}`), ...skipped.map((file) => `skip ${file}`)];
}

/**
 * True when a covered-by pattern matches a changed path.
 * `docs/**` matches `docs` and anything inside it. A `*` matches within one path segment.
 * @param {string} pattern
 * @param {string} file
 * @returns {boolean}
 */
export function pathCovers(pattern, file) {
  const pat = normalize(pattern);
  const path = normalize(file);
  if (!pat || !path) return false;
  if (pat.endsWith("/**")) {
    const prefix = pat.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  if (pat.includes("*")) {
    const re = new RegExp(`^${pat.split("*").map(escapeRegex).join("[^/]*")}$`);
    return re.test(path);
  }
  return path === pat;
}

/**
 * @param {string} root
 * @returns {Map<string, string[]>}
 */
function readCoveredBy(root) {
  const file = join(root, "journeys", "covered-by.yaml");
  if (!existsSync(file)) throw new Error("journeys/covered-by.yaml is missing. List the paths each journey covers, then run this again.");
  const parsed = parse(readFileSync(file, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("journeys/covered-by.yaml must be a map of journey name to paths.");
  /** @type {Map<string, string[]>} */
  const map = new Map();
  for (const [key, value] of Object.entries(parsed)) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
      throw new Error(`journeys/covered-by.yaml: ${key} must be a list of paths, like packages/core/src/doctor.js or skills/**.`);
    }
    map.set(key, value);
  }
  return map;
}

/** @param {string} value */
function normalize(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

/** @param {string} value */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
