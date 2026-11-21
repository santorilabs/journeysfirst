// The skills live in skills/ at the repo root. npm packs only files inside
// packages/core, so prepack copies them into packages/core/skills and postpack
// removes the copy (--remove). `npx journeysfirst init` copies them from there.
import { cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FROM = fileURLToPath(new URL("../skills", import.meta.url));
const TO = fileURLToPath(new URL("../packages/core/skills", import.meta.url));

rmSync(TO, { recursive: true, force: true });
if (!process.argv.includes("--remove")) cpSync(FROM, TO, { recursive: true });
