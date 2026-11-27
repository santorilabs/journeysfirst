// The saved script for "Review a claim". It runs against the app as it is, and
// then against the app with the planted change (DEMO_MOVED_FIELD=1). With
// the change, the billing code is under Details, then Billing, so the script
// clicks there to read it. Every check passes both ways.
import { test } from "journeysfirst/playwright";

const moved = Boolean(process.env.DEMO_MOVED_FIELD);
// A run of the planted change says so, and the compare page shows it.
const tags = moved ? { planted: "This change was planted for a demo: the billing code was moved from the claim's first screen to Details, then Billing." } : {};

test.journey("journeys/review-a-claim.journey.yaml", { tags, repos: [{ repo: "example/claims-review", branch: moved ? "move-billing-code" : "main" }] }, async ({ journey }) => {
  const you = await journey.page("you", { account: "billing reviewer" });
  await you.request.post("/api/reset");
  await you.goto("/");
  const code = you.getByLabel("Billing code");

  await journey.step("Open claim 1042.", { by: "you", caption: "You open claim 1042." }, async () => {
    await you.getByRole("link", { name: "Claim 1042" }).click();
    await you.getByRole("heading", { name: "Claim 1042" }).waitFor();
  });

  await journey.check("sees-billing-code", { by: "you", caption: "Checking that you see the billing code." }, async () => {
    if (moved) {
      await you.getByRole("button", { name: "Details" }).click();
      await you.getByRole("button", { name: "Billing" }).click();
    }
    const shown = (await code.isVisible()) ? await code.inputValue() : "";
    return {
      passed: shown === "4471-B",
      proof: "Read the billing code field on the claim.",
      evidence: [{ source: "page", login: "you", url: you.url(), saw: shown ? `the billing code "${shown}"` : "no billing code" }],
      reason: "The billing code is not on the claim.",
      caption: shown === "4471-B" ? "you see the billing code." : "the billing code is not there.",
    };
  });

  await journey.step("Approve the claim.", { by: "you", caption: "You approve the claim." }, async () => {
    await you.getByRole("button", { name: "Approve" }).click();
    await you.getByText("Approved").waitFor();
  });

  await journey.check("claim-approved", { by: "you", caption: "Checking that the claim stays approved after a reload." }, async () => {
    await you.reload();
    const saved = await (await you.request.get("/api/claim")).json();
    return {
      passed: saved.approved === true,
      proof: "Reloaded the claim and read its saved state from the app.",
      evidence: [{ source: "api", login: "you", url: "/api/claim", got: saved }],
      reason: `The saved state is approved=${saved.approved}.`,
      caption: saved.approved === true ? "the claim is still approved." : "the claim is not approved.",
    };
  });
});
