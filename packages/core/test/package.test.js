// The package as another project imports it: the entry's exports and the
// type declarations shipped in types/.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import * as entry from "journeysfirst";

const ROOT = new URL("..", import.meta.url).pathname;
const SKILLS = join(ROOT, "../../skills");
const TSC = join(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin/tsc");
const tsc = (args) => spawnSync(process.execPath, [TSC, ...args], { cwd: ROOT, encoding: "utf8" });

test("the package entry has what a service needs to take in runs", () => {
  for (const name of ["checkRun", "settle", "settleCheck", "runResult", "verifiedLists", "runFiles", "runDigest", "stableJson", "parseJourney", "validateJourney", "journeyVersion", "caseIds", "journeyPlan", "validateRun", "screenshotFile"]) {
    assert.equal(typeof entry[name], "function", name);
  }
  assert.equal(entry.FORMAT, "journeysfirst/v1");
  assert.equal(entry.RUN_FORMAT, "journeysfirst-run/v1");
});

test("the display entry and runAnswer import nothing from Node, so a browser can load them", async () => {
  for (const file of ["src/shared/display.js", "src/review/run-answer.js"]) {
    const imports = [...readFileSync(join(ROOT, file), "utf8").matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    assert.ok(imports.every((name) => name === "../shared/display.js"), `${file} imports ${imports.join(", ")}`);
  }
  const display = await import("journeysfirst/display");
  for (const name of ["isCheck", "screenshotFile", "screenshotPage", "stepState", "runTitle", "clock", "videoAt"]) assert.equal(typeof display[name], "function", name);
  assert.equal(display.LABELS.not_fully_checked, "Not fully checked");
  assert.equal(entry.isCheck, display.isCheck, "the main entry re-exports the same isCheck");
});

test("the committed types match the source", () => {
  const out = mkdtempSync(join(tmpdir(), "jf-types-"));
  const built = tsc(["-p", ".", "--outDir", out]);
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const declarations = (dir) => readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".d.ts")).sort();
  const committed = declarations(join(ROOT, "types"));
  assert.deepEqual(declarations(out), committed);
  for (const name of committed) {
    assert.equal(readFileSync(join(ROOT, "types", name), "utf8"), readFileSync(join(out, name), "utf8"), `types/${name} is out of date: run npm run types.`);
  }
});

test("every entry in exports has types, and the TypeScript check imports each one", () => {
  const { exports } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const consumer = readFileSync(join(ROOT, "test/consumer.check.ts"), "utf8");
  for (const [subpath, entry] of Object.entries(exports)) {
    assert.ok(entry.types && existsSync(join(ROOT, entry.types)), `${subpath} has no types file`);
    const name = subpath === "." ? "journeysfirst" : `journeysfirst/${subpath.slice(2)}`;
    assert.ok(consumer.includes(`from "${name}"`), `test/consumer.check.ts does not import ${name}`);
  }
});

test("the package ships every skill from the repo's skills/, and only skills there, so init copies only skills", () => {
  // Pack a copy of the repo: prepack writes packages/core/skills, and other test files read skills while this runs.
  const repo = mkdtempSync(join(tmpdir(), "jf-pack-"));
  const core = join(repo, "packages/core");
  for (const name of ["package.json", "README.md", "LICENSE", "src", "types", "bin", "templates"]) cpSync(join(ROOT, name), join(core, name), { recursive: true });
  cpSync(SKILLS, join(repo, "skills"), { recursive: true });
  cpSync(join(ROOT, "../../scripts/copy-skills.mjs"), join(repo, "scripts/copy-skills.mjs"));
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: core, encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const files = JSON.parse(packed.stdout)[0].files.map((f) => f.path);
  const underSkills = files.filter((f) => f.startsWith("skills/"));
  assert.deepEqual(underSkills.sort(), readdirSync(SKILLS).sort().map((name) => `skills/${name}/SKILL.md`));
  for (const file of underSkills) assert.match(file, /^skills\/[a-z-]+\/SKILL\.md$/, file);
  assert.ok(!existsSync(join(core, "skills")), "postpack removes the copy prepack made");
  assert.ok(files.includes("templates/app-skill.md"), "the app skill template ships outside skills/");
  for (const name of ["index.html", "serve.mjs", "see-the-example.journey.yaml", "see-the-example.spec.js"]) {
    assert.ok(files.includes(`templates/demo/${name}`), `templates/demo/${name} ships so init can copy the example`);
  }
});

test("each skill's name matches its folder, so a copied skill is found by the name the docs use", () => {
  for (const folder of readdirSync(SKILLS)) {
    const text = readFileSync(join(SKILLS, folder, "SKILL.md"), "utf8");
    assert.match(text, new RegExp(`^---\\nname: ${folder}\\n`), `skills/${folder}/SKILL.md`);
  }
});

test("the app skill template asks for one proven test send, to an address that can never deliver, before journeys that send", () => {
  const template = readFileSync(join(ROOT, "templates/app-skill.md"), "utf8");
  assert.match(template, /one test send to an address that can never deliver .* and find it in the sink/);
});

test("a TypeScript project can import the package with types", () => {
  const checked = tsc(["-p", "test"]);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
});
