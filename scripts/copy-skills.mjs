// The skills, the specs and the docs live at the repo root. npm packs only
// files inside packages/core, so prepack copies them in and postpack removes
// the copies (--remove). init reads skills from the copy. An installed package
// also has spec/ and docs/ for an agent to read.
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CORE = join(ROOT, "packages/core");
const DIRS = ["skills", "spec", "docs"];
const remove = process.argv.includes("--remove");

for (const name of DIRS) {
  const to = join(CORE, name);
  rmSync(to, { recursive: true, force: true });
  if (!remove) cpSync(join(ROOT, name), to, { recursive: true });
}
