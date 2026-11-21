import { readFileSync } from "node:fs";

/** This package's version. Runs record it, and init and upgrade print it. */
export const VERSION = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
