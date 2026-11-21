import { defineConfig } from "@playwright/test";

// Docmost runs in Docker (./stack.sh up break|fix), from a fresh database each time.
// The npm scripts start it; Playwright does not.
export default defineConfig({
  testDir: "tests",
  timeout: 180_000,
  reporter: [["list"], ["journeysfirst/reporter", { outputDir: process.env.JOURNEYSFIRST_RUNS_DIR ?? "journey-runs" }]],
  use: { trace: "retain-on-failure", viewport: { width: 1280, height: 800 }, baseURL: "http://localhost:3300" },
});
