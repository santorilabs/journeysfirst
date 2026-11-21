import { defineConfig } from "@playwright/test";

// The demo app takes any free port, so two runs at once never share a server.
// Playwright reads the port from the app's first line into DEMO_PORT.
// DEMO_LINK_BUG=1 starts the demo app with a bug: the link keeps working after
// sharing is turned off.
const bug = Boolean(process.env.DEMO_LINK_BUG);

export default defineConfig({
  testDir: "tests",
  reporter: [["list"], ["journeysfirst/reporter", { outputDir: process.env.JOURNEYSFIRST_RUNS_DIR ?? "journey-runs" }]],
  // A failed run keeps Playwright's trace in its run folder.
  use: { trace: "retain-on-failure", viewport: { width: 1280, height: 800 }, baseURL: `http://localhost:${process.env.DEMO_PORT}` },
  webServer: {
    command: "node app/server.mjs",
    wait: { stdout: /demo app on http:\/\/localhost:(?<demo_port>\d+)/ },
    reuseExistingServer: false,
    env: { PORT: "0", ...(bug ? { DEMO_LINK_BUG: "1" } : {}) },
  },
});
