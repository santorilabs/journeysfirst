import { codex } from "./codex.js";

const adapters = [codex];

/** @param {string | undefined} name @param {string | undefined} container */
export function selectAdapter(name, container) {
  if (name !== undefined) return adapters.find((item) => item.name === name);
  const adapter = adapters.find((item) => item.detect(container) && item.authProbe());
  if (!adapter) throw new Error(`No signed-in agent CLI found. ${adapters.map((item) => item.setup).join(" ")}`);
  return adapter;
}
