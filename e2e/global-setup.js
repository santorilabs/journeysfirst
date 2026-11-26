import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPacks } from "./support.js";

export default function globalSetup() {
  const directory = mkdtempSync(join(tmpdir(), "jf-self-packs-"));
  const clean = () => rmSync(directory, { recursive: true, force: true });
  try {
    process.env.JF_SELF_PACKS = JSON.stringify(buildPacks(directory));
    return clean;
  } catch (error) {
    clean();
    throw error;
  }
}
