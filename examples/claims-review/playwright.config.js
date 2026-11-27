import { defineConfig } from "@playwright/test";

// The demo app takes any free port. Playwright reads it from the app's first line into DEMO_PORT.
// DEMO_MOVED_FIELD=1 starts the app with a change planted on purpose: the billing code is
// 2 clicks further into a claim. Every check still passes.
const moved = Boolean(process.env.DEMO_MOVED_FIELD);

export default defineConfig({
  testDir: "tests",
  reporter: [["list"], ["journeysfirst/reporter", { outputDir: process.env.JOURNEYSFIRST_RUNS_DIR ?? "journey-runs" }]],
  use: { trace: "retain-on-failure", viewport: { width: 1280, height: 800 }, baseURL: `http://localhost:${process.env.DEMO_PORT}` },
  webServer: {
    command: "node app/server.mjs",
    wait: { stdout: /demo app on http:\/\/localhost:(?<demo_port>\d+)/ },
    reuseExistingServer: false,
    env: { PORT: "0", ...(moved ? { DEMO_MOVED_FIELD: "1" } : {}) },
  },
});
