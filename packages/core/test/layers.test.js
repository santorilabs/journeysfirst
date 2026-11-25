// The import rules between layer folders, as docs/how-it-fits.md states them.
// Only import and export statements count. A type named in a doc comment,
// like import("../format/runfile.js").Run, does not.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;

// Which other folders the files in each folder may import. A file may always
// import a file in its own folder. docs/how-it-fits.md has the same table.
const MAY_IMPORT = {
  "src/shared": [],
  "src/format": ["src/format/draft0", "src/shared"],
  "src/format/draft0": ["src/format"],
  "src/runner": ["src/format", "src/shared"],
  "src/review": ["src/format", "src/shared"],
  "src/publish": ["src/format", "src/review", "src/shared"],
  src: ["src/format", "src/shared"],
  bin: ["src", "src/format", "src/publish", "src/review", "src/shared"],
};

const IMPORT = /^\s*(?:import|export)\s[^;"']*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm;

/** @param {string} dir @returns {string[]} */
const jsFiles = (dir) => readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".js")).map((name) => join(dir, name));

/** Each source file and the source files it imports, as paths from packages/core. */
function importGraph() {
  /** @type {Map<string, string[]>} */
  const graph = new Map();
  for (const file of [...jsFiles("src"), ...jsFiles("bin")]) {
    const text = readFileSync(join(ROOT, file), "utf8");
    const specs = [...text.matchAll(IMPORT)].map((m) => m[1] ?? m[2]).filter((spec) => spec.startsWith("."));
    graph.set(file, specs.map((spec) => relative(ROOT, join(ROOT, dirname(file), spec))));
  }
  return graph;
}

test("each file imports only from its own folder or a folder its layer may import", () => {
  const problems = [];
  for (const [file, imports] of importGraph()) {
    const from = dirname(file);
    if (!(from in MAY_IMPORT)) {
      problems.push(`${file}: its folder ${from} is not in MAY_IMPORT. Add it to the table here and in docs/how-it-fits.md.`);
      continue;
    }
    for (const target of imports) {
      const to = dirname(target);
      if (to !== from && !MAY_IMPORT[from].includes(to)) problems.push(`${file} imports ${target}, but ${from} may not import ${to}.`);
    }
  }
  assert.deepEqual(problems, []);
});

test("no file imports itself through a loop", () => {
  const graph = importGraph();
  const done = new Set();
  /** @param {string} file @param {string[]} path */
  const visit = (file, path) => {
    if (path.includes(file)) assert.fail(`Import loop: ${[...path.slice(path.indexOf(file)), file].join(" -> ")}`);
    if (done.has(file)) return;
    for (const next of graph.get(file) ?? []) visit(next, [...path, file]);
    done.add(file);
  };
  for (const file of graph.keys()) visit(file, []);
});

test("docs/how-it-fits.md shows the same import table", () => {
  const doc = readFileSync(join(ROOT, "../../docs/how-it-fits.md"), "utf8");
  const rows = [...doc.matchAll(/^\| `([^`]+)` \| (.*) \|$/gm)].filter(([, folder]) => folder in MAY_IMPORT || folder.startsWith("src") || folder === "bin");
  const shown = Object.fromEntries(rows.map(([, folder, cell]) => [folder, [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1])]));
  assert.deepEqual(shown, MAY_IMPORT);
});
