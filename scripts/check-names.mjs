// Fails if the open core depends on private code, or if any tracked text file
// names something private. Two checks:
//   1. packages/core/src imports only node:, relative files and the allowlist.
//   2. Every tracked text file (code, skills, templates, docs, examples,
//      workflows, agent rules) is free of the deny list below.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const SELF = "scripts/check-names.mjs"; // it holds the deny list, so it is not scanned for it
const ALLOWED_IMPORTS = new Set(["yaml", "@playwright/test"]);
const IMPORT = /(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

// Removed before the deny list runs: the public repo and the copyright holder
// (also as "Santori_Labs", the spelling in a badge URL).
const ALLOWED_TEXT = [/santorilabs\/journeysfirst\b/gi, /Santori[ _]Labs/g];
const DENY = [
  { name: "Tempo", pattern: /tempo(?!r)/i }, // not "temporary" or "temporal"
  { name: "Santori", pattern: /santori/i },
  { name: "station.site", pattern: /station\.site/i },
  { name: "journeysfirst-cloud", pattern: /journeysfirst-cloud/i },
  { name: "a private session, attachment, or team message link", pattern: /https?:\/\/(?:app\.devin\.ai\/(?:sessions|attachments)\/|[\w-]+\.slack\.com\/archives\/)/i },
];
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
// Test addresses and GitHub's noreply addresses are fine. Any other address may be a real person's.
const allowedEmail = (domain) => /(^|\.)example\.test$/i.test(domain) || /(^|\.)noreply\.github\.com$/i.test(domain);

const problems = [];
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: REPO }).toString().split("\0").filter(Boolean);

for (const file of tracked) {
  const bytes = readFileSync(join(REPO, file));
  if (bytes.includes(0)) continue; // binary, like a PNG
  const text = bytes.toString("utf8");
  if (file.startsWith("packages/core/src/") && /\.m?js$/.test(file)) problems.push(...importProblems(file, text));
  if (file === SELF) continue;
  text.split("\n").forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    const cleaned = ALLOWED_TEXT.reduce((s, allowed) => s.replace(allowed, ""), line);
    for (const { name, pattern } of DENY) if (pattern.test(cleaned)) problems.push(`${where}: names ${name}`);
    for (const [, domain] of line.matchAll(EMAIL)) if (!allowedEmail(domain)) problems.push(`${where}: has an email address at ${domain}. Use one at example.test.`);
  });
}

if (problems.length) {
  console.error(`Private names or code in the open core. Remove or replace each one:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`check-names: ok (${tracked.length} tracked files)`);

/**
 * @param {string} file
 * @param {string} text
 */
function importProblems(file, text) {
  const found = [];
  for (const match of text.matchAll(IMPORT)) {
    const spec = match[1] ?? match[2];
    // A subpath of an allowed package, like @playwright/test/reporter, is that package.
    const pkg = spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");
    if (spec.startsWith(".") || spec.startsWith("node:") || ALLOWED_IMPORTS.has(pkg)) continue;
    found.push(`${file}: imports "${spec}"`);
  }
  return found;
}
