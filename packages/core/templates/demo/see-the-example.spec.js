// journeysfirst example. It passes against demo/index.html.
// Delete this file when you point Playwright at your app.
// recording and measure are off so the first run is short. A journey for your product leaves both on.
import { test } from "journeysfirst/playwright";

test.journey("journeys/see-the-example.journey.yaml", { recording: false, measure: false }, async ({ journey }) => {
  const you = await journey.page("you", { account: "signed out" });

  await journey.step("Open the page and choose \"I am in\".", { by: "you" }, async () => {
    await you.goto("/");
    await you.getByRole("button", { name: "I am in" }).click();
  });

  await journey.check("you-are-in", { by: "you" }, async () => {
    const status = you.locator("#status");
    const text = await status.textContent();
    const visible = await status.isVisible();
    return {
      passed: visible && text === "You are in.",
      proof: "Opened the example page, chose I am in, and read the status line.",
      evidence: [{ source: "page", login: "you", url: you.url(), saw: visible ? `the status "${text}"` : "no status line" }],
      reason: visible ? `The status was "${text}".` : "The status line stayed hidden.",
    };
  });
});
