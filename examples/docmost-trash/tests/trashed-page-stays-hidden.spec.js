// The saved script for "A page in Trash is hidden from everyone else".
// Docmost runs locally from a fresh database (./stack.sh). The start state is
// made with Docmost's own API: workspace setup, a space, a page import, an
// invite caught by the local mail sink, and a public share.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request as pwRequest } from "@playwright/test";
import { test } from "journeysfirst/playwright";

const BASE = "http://localhost:3300";
const MAILPIT = "http://localhost:8325";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TITLE = "Salary bands 2025";
const TEXT = "Senior engineer band is 180k";
const tag = Date.now().toString(36);
const owner = { name: "Owner", email: `owner-${tag}@example.test`, password: `pw-${tag}-owner` };
const mate = { name: "Teammate", email: `teammate-${tag}@example.test`, password: `pw-${tag}-mate` };

async function api(ctx, url, data) {
  const res = await ctx.post(`/api${url}`, { data: data ?? {} });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body, data: body.data };
}

async function makeStart() {
  const admin = await pwRequest.newContext({ baseURL: BASE });
  const setup = await api(admin, "/auth/setup", { name: owner.name, email: owner.email, password: owner.password, workspaceName: "Proof" });
  if (setup.status >= 300) throw new Error(`setup failed: ${setup.status} ${JSON.stringify(setup.body)}`);
  const space = (await api(admin, "/spaces/create", { name: "Team", slug: "team" })).data;
  const imported = await admin.post("/api/pages/import", {
    multipart: {
      spaceId: space.id,
      file: { name: "salary-bands-2025.md", mimeType: "text/markdown", buffer: fs.readFileSync(path.join(HERE, "salary-bands-2025.md")) },
    },
  });
  const page = (await imported.json()).data;
  // Invite the teammate. The invite email lands in the local mail sink.
  await api(admin, "/workspace/invites/create", { emails: [mate.email], role: "member", groupIds: [] });
  let mail;
  for (let i = 0; i < 30 && !mail; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${mate.email}`)}`)).json();
    mail = list.messages?.[0];
    if (!mail) await new Promise((r) => setTimeout(r, 500));
  }
  if (!mail) throw new Error("invite email did not reach the local mail sink");
  const msg = await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}`)).json();
  const link = (msg.HTML || msg.Text).match(/\/invites\/([0-9a-f-]{36})\?token=([A-Za-z0-9_-]+)/);
  const guest = await pwRequest.newContext({ baseURL: BASE });
  const accepted = await api(guest, "/workspace/invites/accept", { invitationId: link[1], token: link[2], name: mate.name, password: mate.password });
  if (accepted.status >= 300) throw new Error(`accept failed: ${JSON.stringify(accepted.body)}`);
  const me = (await api(guest, "/users/me")).data;
  await api(admin, "/spaces/members/add", { spaceId: space.id, role: "reader", userIds: [me.user.id], groupIds: [] });
  const share = (await api(admin, "/shares/create", { pageId: page.id, includeSubPages: false, searchIndexing: false })).data;
  await admin.dispose();
  await guest.dispose();
  return { space, page, share, inviteMailId: mail.ID, publicLink: `${BASE}/share/${share.key}/p/${page.slugId}` };
}

const signIn = (who) => async (context, page) => {
  const res = await page.request.post(`${BASE}/api/auth/login`, { data: { email: who.email, password: who.password } });
  if (!res.ok()) throw new Error(`login failed for ${who.name}: ${res.status()}`);
};

async function searchAs(page, spaceId, query) {
  await page.getByText("Search", { exact: true }).first().click();
  const box = page.getByPlaceholder("Search...");
  const resp = page.waitForResponse((r) => r.url().endsWith("/api/search") && r.request().method() === "POST");
  await box.fill(query);
  const res = await resp;
  const body = await res.json();
  await page.waitForTimeout(500);
  const titles = (body.data ?? []).map((p) => p.title);
  return { titles, request: { query, spaceId } };
}

// DOCMOST_COMMIT is set by the npm scripts, so each run records which commit it ran on.
const repos = [{ repo: "docmost/docmost", commit: process.env.DOCMOST_COMMIT }];

test.journey("journeys/trashed-page-stays-hidden.journey.yaml", { repos }, async ({ journey }) => {
  const start = await makeStart();
  journey.value("public_link", start.publicLink);

  const you = await journey.page("you", { account: owner.email, login: signIn(owner) });
  const viewer = await journey.page("viewer", { account: "signed out" });
  const teammate = await journey.page("teammate", { account: mate.email, login: signIn(mate) });
  const pageUrl = `/s/team/p/${start.page.slugId}`;

  const readShared = async () => {
    await viewer.goto(start.publicLink);
    await viewer.waitForLoadState("networkidle");
    await viewer.waitForTimeout(1000);
    const body = await viewer.locator("body").innerText();
    const res = await viewer.request.post(`${BASE}/api/shares/page-info`, { data: { pageId: start.page.slugId, shareId: start.share.key } });
    const info = await res.json().catch(() => ({}));
    return { body, apiStatus: res.status(), apiTitle: info.data?.page?.title ?? null };
  };

  await journey.step("The viewer opens the public link.", { by: "viewer", caption: "The viewer opens the public link, signed out." }, async () => {
    await viewer.goto(start.publicLink);
    await viewer.getByText(TEXT).waitFor();
  });

  await journey.check("viewer-reads-before", { by: "viewer", caption: "Checking that the viewer can read the page." }, async () => {
    const seen = await readShared();
    const ok = seen.body.includes(TITLE) && seen.body.includes(TEXT);
    return {
      passed: ok,
      proof: "Opened the public link in a signed-out browser and read the page text.",
      evidence: [
        { source: "page", login: "viewer", url: viewer.url(), saw: ok ? `the title "${TITLE}" and the text "${TEXT}"` : seen.body.slice(0, 200) },
        { source: "api", login: "viewer", url: "/api/shares/page-info", got: { status: seen.apiStatus, title: seen.apiTitle } },
      ],
      reason: "The viewer could not read the shared page before it was deleted.",
      caption: ok ? "the viewer reads the page." : "the viewer cannot read the page.",
    };
  });

  let before;
  await journey.step("The teammate searches for \"Salary bands\".", { by: "teammate", caption: "The teammate searches for Salary bands." }, async () => {
    await teammate.goto("/s/team");
    before = await searchAs(teammate, start.space.id, "Salary bands");
  });

  await journey.check("teammate-finds-before", { by: "teammate", caption: "Checking that the teammate finds the page." }, async () => {
    const shown = await teammate.getByRole("dialog").getByText(TITLE).count();
    const ok = before.titles.includes(TITLE) && shown > 0;
    return {
      passed: ok,
      proof: "Searched in the teammate's own session and read the results list and the search response.",
      evidence: [
        { source: "page", login: "teammate", url: teammate.url(), saw: `${shown} result(s) titled "${TITLE}"` },
        { source: "api", login: "teammate", url: "/api/search", got: { titles: before.titles } },
      ],
      reason: `The teammate's results were ${JSON.stringify(before.titles)}.`,
      caption: ok ? "the teammate finds the page." : "the teammate does not find the page.",
    };
  });

  await journey.step("Delete \"Salary bands 2025\".", { by: "you", caption: "You move the page to Trash." }, async () => {
    await you.goto(pageUrl);
    await you.getByText(TEXT).waitFor();
    const node = you.getByRole("treeitem").filter({ hasText: TITLE }).first();
    await node.hover();
    // The page row shows a menu button and an add button on hover; the menu is the second to last.
    await node.locator("button").nth(-2).click();
    await you.getByRole("menuitem", { name: "Move to trash" }).click();
    const deleted = you.waitForResponse((r) => r.url().endsWith("/api/pages/delete"));
    await you.getByRole("button", { name: "Move to trash" }).click();
    await deleted;
  });

  await journey.check("in-trash", { by: "you", caption: "Checking that the page is in the space's Trash." }, async () => {
    await you.goto("/s/team/trash");
    await you.reload();
    await you.waitForLoadState("networkidle");
    const shown = await you.getByText(TITLE).count();
    const res = await api(you.request, "/pages/trash", { spaceId: start.space.id });
    const titles = (res.data?.items ?? []).map((p) => p.title);
    const ok = shown > 0 && titles.includes(TITLE);
    return {
      passed: ok,
      proof: "Reloaded the space's Trash page and read the Trash list from the app.",
      evidence: [
        { source: "page", login: "you", url: you.url(), saw: `${shown} row(s) titled "${TITLE}"` },
        { source: "api", login: "you", url: "/api/pages/trash", got: { status: res.status, titles } },
      ],
      reason: `The Trash list was ${JSON.stringify(titles)}.`,
      caption: ok ? "the page is in Trash." : "the page is not in Trash.",
    };
  });

  let after;
  await journey.step("The viewer opens the public link again.", { by: "viewer", caption: "The viewer opens the same public link again." }, async () => {
    after = await readShared();
  });

  await journey.check("viewer-blocked", { by: "viewer", caption: "Checking that the viewer can no longer read the page." }, async () => {
    const sawTitle = after.body.includes(TITLE);
    const sawText = after.body.includes(TEXT);
    const ok = !sawTitle && !sawText && after.apiTitle === null;
    return {
      passed: ok,
      proof: "Opened the public link again in the viewer's signed-out browser, read the page text and the shared page response.",
      evidence: [
        { source: "page", login: "viewer", url: viewer.url(), saw: ok ? "no title and no page text" : `title shown: ${sawTitle}, text "${TEXT}" shown: ${sawText}` },
        { source: "api", login: "viewer", url: "/api/shares/page-info", got: { status: after.apiStatus, title: after.apiTitle } },
      ],
      reason: `The viewer still reads "${TITLE}" and "${TEXT}" from the public link after the page was moved to Trash (shares/page-info returned ${after.apiStatus}).`,
      caption: ok ? "the link no longer shows the page." : "the viewer still reads the deleted page.",
    };
  });

  let later;
  await journey.step("The teammate searches for \"Salary bands\" again.", { by: "teammate", caption: "The teammate searches for Salary bands again." }, async () => {
    await teammate.goto("/s/team");
    await teammate.reload();
    later = await searchAs(teammate, start.space.id, "Salary bands");
  });

  await journey.check("teammate-search-hidden", { by: "teammate", caption: "Checking that search no longer shows the page." }, async () => {
    const shown = await teammate.getByRole("dialog").getByText(TITLE).count();
    const ok = !later.titles.includes(TITLE) && shown === 0;
    return {
      passed: ok,
      proof: "Searched again in the teammate's own session and read the results list and the search response.",
      evidence: [
        { source: "page", login: "teammate", url: teammate.url(), saw: `${shown} result(s) titled "${TITLE}"` },
        { source: "api", login: "teammate", url: "/api/search", got: { titles: later.titles } },
      ],
      reason: `The teammate's search still shows "${TITLE}" after it was moved to Trash.`,
      caption: ok ? "search no longer shows the page." : "search still shows the deleted page.",
    };
  });

  await journey.step("The teammate tries to open the space's Trash.", { by: "teammate", caption: "The teammate opens the space's Trash address." }, async () => {
    await teammate.keyboard.press("Escape");
    await teammate.goto("/s/team/trash");
    await teammate.waitForLoadState("networkidle");
    await teammate.waitForTimeout(1000);
  });

  await journey.check("teammate-no-trash", { by: "teammate", caption: "Checking that the teammate cannot see the page in Trash." }, async () => {
    const shown = await teammate.getByText(TITLE).count();
    const res = await api(teammate.request, "/pages/trash", { spaceId: start.space.id });
    const titles = (res.data?.items ?? []).map((p) => p.title);
    const ok = shown === 0 && !titles.includes(TITLE);
    return {
      passed: ok,
      proof: "Opened the space's Trash in the teammate's own session and asked the app for the Trash list as the teammate.",
      evidence: [
        { source: "page", login: "teammate", url: teammate.url(), saw: `${shown} row(s) titled "${TITLE}"` },
        { source: "api", login: "teammate", url: "/api/pages/trash", got: { status: res.status, titles } },
      ],
      reason: `The teammate, who has "Can view", sees "${TITLE}" in the space's Trash.`,
      caption: ok ? "the teammate cannot see the Trash." : "the teammate sees the deleted page in Trash.",
    };
  });
});
