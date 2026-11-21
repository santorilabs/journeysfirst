import { defineConfig } from "@playwright/test";

// Immich runs in Docker from Immich's CI image for one commit (./stack.sh up <sha>).
// The npm scripts start it; Playwright does not. IMMICH_COMMIT names the running
// commit, and the test checks it against the server's /api/server/about first.
export default defineConfig({
  testDir: "tests",
  timeout: 300_000,
  reporter: [["list"], ["journeysfirst/reporter", { outputDir: process.env.JOURNEYSFIRST_RUNS_DIR ?? "journey-runs" }]],
  use: { trace: "retain-on-failure", viewport: { width: 1280, height: 800 }, baseURL: process.env.IMMICH_URL ?? "http://127.0.0.1:2285" },
});
