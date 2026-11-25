// Written by `npx journeysfirst init`, then changed for these journeys: each
// journey copies a fresh app, lets Codex change it, and starts that copy's own
// dev server (e2e/agent.js), so there is no shared webServer here.
import { defineConfig } from "@playwright/test";

const port = Number(process.env.JOURNEYS_PORT ?? 4321);

export default defineConfig({
  testDir: "e2e",
  outputDir: `test-results/${port}`,
  // Codex takes minutes per prompt.
  timeout: 20 * 60 * 1000,
  workers: 3,
  reporter: [["list"], ["journeysfirst/reporter", { outputDir: "journey-runs" }]],
  use: { trace: "retain-on-failure" },
});
