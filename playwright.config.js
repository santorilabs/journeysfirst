import { defineConfig } from "@playwright/test";

const runs = process.env.JF_RUNS || "journey-runs";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.js",
  timeout: 240_000,
  workers: 1,
  reporter: [["list"], ["journeysfirst/reporter", { outputDir: runs }]],
  outputDir: "test-results/self",
  use: { baseURL: "http://127.0.0.1:9", trace: "retain-on-failure", video: "off" },
});
