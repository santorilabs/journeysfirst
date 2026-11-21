// The saved script for "Share a presentation by link". An agent writes this
// once by driving the browser; after that it replays with no model.
// Each line of the journey is one journey.step (by its sentence) or one
// journey.check (by its id), and says who did it. Each user has their own
// browser context. Each caption is one plain sentence for the video.
import { expect, test } from "journeysfirst/playwright";

test.journey("journeys/share-by-link.journey.yaml", async ({ journey }) => {
  // You sign in with the app's one-time link. The viewer stays signed out.
  const you = await journey.page("you", { account: "owner", login: (context, page) => page.goto("/signin/owner") });
  await you.request.post("/api/reset");
  await you.goto("/");
  const toggle = you.getByLabel("Anyone with the link can view");
  const saved = () => you.waitForResponse((r) => r.url().endsWith("/api/share") && r.request().method() === "POST");
  let link = "";

  await journey.step("Turn on link sharing and send the link to the viewer.", { by: "you", caption: "You turn on link sharing and copy the link." }, async () => {
    await you.getByRole("button", { name: "Share" }).click();
    await Promise.all([saved(), toggle.check()]);
    await you.getByRole("button", { name: "Copy link" }).click();
    link = await you.evaluate(() => navigator.clipboard.readText());
    journey.value("link", link);
  });

  await journey.check("link-on", { by: "you", caption: "Checking that link sharing stays on after a reload." }, async () => {
    await you.reload();
    await you.getByRole("button", { name: "Share" }).click();
    await expect(toggle).toBeChecked();
    const saved = await (await you.request.get("/api/share")).json();
    return {
      passed: saved.linkSharing === true,
      proof: "Reloaded the page, saw the box still checked, and read the saved setting from the app.",
      evidence: [
        { source: "page", login: "you", url: you.url(), saw: "the link sharing box is checked after a reload" },
        { source: "api", login: "you", url: "/api/share", got: saved },
      ],
      reason: `The saved setting is linkSharing=${saved.linkSharing}.`,
      caption: saved.linkSharing === true ? "the sharing box is still checked after a reload." : "link sharing turned itself off after a reload.",
    };
  });

  const viewer = await journey.page("viewer", { account: "signed out" });

  await journey.step("The viewer opens the link.", { by: "viewer", caption: "The viewer opens the link." }, async () => {
    await viewer.goto(link);
    await viewer.getByRole("heading").first().waitFor();
  });

  await journey.check("viewer-sees-it", { by: "viewer", caption: "Checking that the viewer sees Q3 plan." }, async () => {
    const heading = await viewer.getByRole("heading").first().textContent();
    return {
      passed: heading === "Q3 plan",
      proof: "Opened the link in the viewer's own browser and read the heading.",
      evidence: [{ source: "page", login: "viewer", url: viewer.url(), saw: `the heading "${heading}"` }],
      reason: `The viewer saw "${heading}" instead.`,
      caption: heading === "Q3 plan" ? "the viewer sees Q3 plan." : "the viewer sees a different page.",
    };
  });

  await journey.step("Turn off link sharing.", { by: "you", caption: "You turn off link sharing." }, async () => {
    await Promise.all([saved(), toggle.uncheck()]);
  });

  await journey.step("The viewer opens the link again.", { by: "viewer", caption: "The viewer opens the link again." }, async () => {
    await viewer.goto(link);
    await viewer.getByRole("heading").first().waitFor();
  });

  await journey.check("viewer-blocked", { by: "viewer", caption: "Checking that the link no longer opens Q3 plan." }, async () => {
    const heading = await viewer.getByRole("heading").first().textContent();
    return {
      passed: heading === "You don't have access",
      proof: "Opened the link again in the viewer's own browser and read the heading.",
      evidence: [{ source: "page", login: "viewer", url: viewer.url(), saw: `the heading "${heading}"` }],
      reason: "The link still works after sharing was turned off.",
      caption: heading === "You don't have access" ? "the viewer gets a no access page." : `the viewer sees "${heading}".`,
    };
  });
});
