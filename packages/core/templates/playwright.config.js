// Written by `npx journeysfirst init` or `npx journeysfirst upgrade` when the repo had no Playwright config.
// Check webServer's command and env for this app.
import { defineConfig } from "@playwright/test";

// The app's port. To run journeys twice at once in one repo (two agents, say),
// give each run its own: JOURNEYS_PORT=4322 npx playwright test
const port = Number(process.env.JOURNEYS_PORT ?? 4321);

export default defineConfig({
  // Journey scripts live in e2e/. If the repo's unit test runner picks them up, exclude e2e/ there.
  testDir: "e2e",
  // Playwright empties this folder when a run starts, so each port gets its own.
  outputDir: `test-results/${port}`,
  reporter: [["list"], ["journeysfirst/reporter", { outputDir: "journey-runs" }]],
  // A run that fails keeps Playwright's trace in its run folder. A passing run keeps none.
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  webServer: {
    // The app must listen on PORT. For a Vite app: `npm run dev -- --port ${port} --strictPort`.
    command: "npm run dev",
    url: `http://localhost:${port}`,
    // Keep this false. With true, Playwright uses any server already on the port,
    // and that server may be running with production keys.
    reuseExistingServer: false,
    // Pass every value the server needs here. Your shell may export values from
    // another product (like DATABASE_URL) that win over the app's env file.
    env: { PORT: String(port) },
  },
});
