// The saved script for "Share an album by link with photo details hidden".
// You (the owner) work in the browser. The viewer has no account: they open the
// link in their own signed-out browser, and their photo frame app reads the
// album through the API with only the link.
import { readFileSync } from "node:fs";
import { expect, test } from "journeysfirst/playwright";

const COMMIT = process.env.IMMICH_COMMIT;
const PHOTO = new URL("../fixtures/tram.jpg", import.meta.url);
const ALBUM = "Spring trip";
// What the photo's details hold. None of it may reach someone with the link.
const HIDDEN_WORDS = ["Lisbon", "Portugal", "Baixa", "FUJIFILM", "X100V", "tram.jpg"];
const HIDDEN_KEYS = ["latitude", "longitude", "city", "state", "country", "make", "model", "originalFileName"];

// Every place in a JSON body that gives away a hidden detail, as "path = value".
function leaks(body, path = "") {
  if (body === null || body === undefined) return [];
  if (Array.isArray(body)) return body.flatMap((v, i) => leaks(v, `${path}[${i}]`));
  if (typeof body === "object") {
    return Object.entries(body).flatMap(([k, v]) => {
      const here = path ? `${path}.${k}` : k;
      if (HIDDEN_KEYS.includes(k) && v !== null && v !== undefined && v !== "") return [`${here} = ${JSON.stringify(v)}`];
      return leaks(v, here);
    });
  }
  const text = String(body);
  return HIDDEN_WORDS.some((w) => text.includes(w)) ? [`${path} = ${JSON.stringify(body)}`] : [];
}

test.journey("journeys/share-album-hide-details.journey.yaml", { repos: [{ repo: "immich-app/immich", commit: COMMIT }] }, async ({ journey, request }) => {
  // ---- start: an admin, a fresh owner, one photo with location and camera, one album, no links.
  const api = (path) => `/api${path}`;
  const json = async (res) => { expect(res.ok(), `${res.url()} ${res.status()} ${await res.text()}`).toBeTruthy(); return res.json(); };
  const runTag = Date.now().toString(36);
  const owner = { email: `owner-${runTag}@example.test`, password: `owner-${runTag}-pw` };

  await request.post(api("/auth/admin-sign-up"), { data: { email: "admin@example.test", password: "admin-pass-1", name: "Admin" } }); // 400 once it exists
  const admin = await json(await request.post(api("/auth/login"), { data: { email: "admin@example.test", password: "admin-pass-1" } }));
  const asAdmin = { authorization: `Bearer ${admin.accessToken}` };
  const about = await json(await request.get(api("/server/about"), { headers: asAdmin }));
  expect(about.sourceCommit, "the running server is the commit named in IMMICH_COMMIT").toBe(COMMIT);
  await json(await request.post(api("/admin/users"), { headers: asAdmin, data: { ...owner, name: "Owner", shouldChangePassword: false } }));
  const ownerLogin = await json(await request.post(api("/auth/login"), { data: owner }));
  const asOwner = { authorization: `Bearer ${ownerLogin.accessToken}` };
  await json(await request.put(api("/users/me/onboarding"), { headers: asOwner, data: { isOnboarded: true } })); // an existing user, past the welcome screens
  const uploaded = await json(await request.post(api("/assets"), {
    headers: asOwner,
    multipart: {
      assetData: { name: "tram.jpg", mimeType: "image/jpeg", buffer: readFileSync(PHOTO) },
      deviceAssetId: `tram-${runTag}`, deviceId: "journey", fileCreatedAt: "2026-05-02T10:15:00Z", fileModifiedAt: "2026-05-02T10:15:00Z",
    },
  }));
  const photoId = uploaded.id;
  const album = await json(await request.post(api("/albums"), { headers: asOwner, data: { albumName: ALBUM, assetIds: [photoId] } }));
  // The server reads the photo's details in the background. Wait until the owner sees them.
  await expect.poll(async () => (await json(await request.get(api(`/assets/${photoId}`), { headers: asOwner }))).exifInfo?.latitude, { timeout: 120_000 }).not.toBeNull();
  const ownerView = (await json(await request.get(api(`/assets/${photoId}`), { headers: asOwner }))).exifInfo;
  expect([ownerView.city, ownerView.country, ownerView.make, ownerView.model]).toEqual(["Baixa", "Portugal", "FUJIFILM", "X100V"]);
  expect((await json(await request.get(api("/shared-links"), { headers: asOwner }))).filter((l) => l.album?.id === album.id)).toEqual([]);
  journey.value("owner_email", owner.email);

  // ---- you, in the browser
  const you = await journey.page("you", {
    account: owner.email,
    login: async (context, page) => {
      await page.goto("/auth/login");
      await page.getByLabel("Email").fill(owner.email);
      await page.getByLabel("Password").fill(owner.password);
      await page.getByRole("button", { name: /login/i }).click();
      await page.waitForURL(/\/photos/);
    },
  });
  let link = "";

  await journey.step(1, { by: "you", caption: `You create a shared link for ${ALBUM} with Show metadata turned off.` }, async () => {
    await you.goto(`/albums/${album.id}`);
    await expect(you.getByRole("textbox", { name: "Edit Title" })).toHaveValue(ALBUM);
    await you.getByRole("button", { name: "Share" }).first().click();
    await you.getByRole("button", { name: "Create link" }).click();
    const form = you.getByRole("dialog").last();
    const showMetadata = form.getByRole("switch", { name: "Show metadata" });
    await showMetadata.click();
    await expect(showMetadata).toHaveAttribute("aria-checked", "false");
    await form.getByRole("button", { name: "Create link" }).click();
    const shown = you.getByRole("dialog").last().locator("input[disabled]");
    await expect(shown).toHaveValue(/\/share\//);
    link = await shown.inputValue();
    journey.value("link", link);
  });

  await journey.check("link-hides-metadata", { by: "you", caption: "Checking that Show metadata is still off after a reload." }, async () => {
    await you.reload();
    await expect(you.getByRole("textbox", { name: "Edit Title" })).toHaveValue(ALBUM);
    const links = await (await you.request.get(api("/shared-links"))).json();
    const mine = links.filter((l) => l.album?.id === album.id).map((l) => ({ type: l.type, showMetadata: l.showMetadata, albumName: l.album.albumName }));
    const off = mine.length === 1 && mine[0].showMetadata === false;
    return {
      passed: off,
      proof: "Reloaded the album page and read your shared links from the app.",
      evidence: [{ source: "api", login: "you", url: api("/shared-links"), got: mine }],
      reason: `Your shared links for ${ALBUM}: ${JSON.stringify(mine)}.`,
      caption: off ? "Show metadata is still off." : "Show metadata is on, or the link is missing.",
    };
  });

  // ---- the viewer, signed out, with only the link
  const viewer = await journey.page("viewer", { account: "signed out" });

  await journey.step(3, { by: "viewer", caption: "The viewer opens the link and opens the photo." }, async () => {
    await viewer.goto(link);
    await viewer.getByText(ALBUM).first().waitFor();
    await viewer.locator(`[data-asset-id="${photoId}"], a[href*="/photos/${photoId}"]`).first().click();
    await viewer.waitForURL(new RegExp(`/photos/${photoId}`));
    await viewer.waitForLoadState("networkidle");
  });

  await journey.check("viewer-sees-photo", { by: "viewer", caption: `Checking that the viewer sees the photo from ${ALBUM}.` }, async () => {
    const shown = await viewer.locator("img").evaluateAll((imgs) => imgs.filter((i) => i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().width > 300).length);
    const asksToSignIn = await viewer.getByLabel("Password").count();
    const ok = shown > 0 && asksToSignIn === 0 && viewer.url().includes(`/photos/${photoId}`);
    return {
      passed: ok,
      proof: "Opened the link in the viewer's own signed-out browser, opened the photo, and found it drawn on the page with no sign-in form.",
      evidence: [{ source: "page", login: "viewer", url: viewer.url(), saw: `${shown} loaded photo on screen, ${asksToSignIn} sign-in form` }],
      reason: `The viewer's page had ${shown} loaded photos and ${asksToSignIn} sign-in forms.`,
      caption: ok ? "the viewer sees the photo." : "the viewer does not see the photo.",
    };
  });

  await journey.check("page-hides-details", { by: "viewer", caption: "Checking that the viewer's page shows no location, camera or file name." }, async () => {
    await viewer.keyboard.press("i"); // the photo viewer's shortcut for the details panel
    await viewer.waitForTimeout(800);
    const visible = await viewer.locator("body").innerText();
    const spoken = await viewer.locator("[alt], [aria-label], [title]").evaluateAll((els) => els.map((e) => [e.getAttribute("alt"), e.getAttribute("aria-label"), e.getAttribute("title")].filter(Boolean).join(" ")).join(" | "));
    const text = `${visible}\n${spoken}`;
    const found = HIDDEN_WORDS.filter((w) => text.includes(w));
    return {
      passed: found.length === 0,
      proof: "Opened the photo in the viewer's browser, asked for its details, and read every word on the page, including image descriptions a screen reader reads.",
      evidence: [{ source: "page", login: "viewer", url: viewer.url(), saw: found.length ? `the page shows ${found.join(", ")}` : `none of ${HIDDEN_WORDS.join(", ")} on the page` }],
      reason: `The viewer's page shows ${found.join(", ")}.`,
      caption: found.length ? `the page shows ${found.join(", ")}.` : "the page shows none of the photo's details.",
    };
  });

  // ---- the viewer's photo frame app: the same link, through the API, no account.
  // It reads the album every way the API offers someone with only the link.
  const calls = [];
  const appGet = async (label, method, path, data) => {
    const url = `${api(path)}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(new URL(link).pathname.split("/").pop())}`;
    const res = method === "GET" ? await viewer.request.get(url) : await viewer.request.post(url, { data });
    const body = await res.json().catch(() => null);
    calls.push({ call: label, method, path, status: res.status(), body });
    return body;
  };

  await journey.step(6, { by: "viewer", caption: `The viewer's photo frame app loads every photo in ${ALBUM} with the link.` }, async () => {
    const me = await appGet("the link itself", "GET", "/shared-links/me");
    const albumId = me.album.id;
    await appGet("the album", "GET", `/albums/${albumId}`);
    await appGet("search the album's photos with details", "POST", "/search/metadata", { albumIds: [albumId], withExif: true });
    const buckets = (await appGet("the album's timeline", "GET", `/timeline/buckets?albumId=${albumId}`)) ?? [];
    for (const b of buckets) await appGet(`timeline bucket ${b.timeBucket}`, "GET", `/timeline/bucket?albumId=${albumId}&timeBucket=${b.timeBucket}`);
    const ids = new Set();
    for (const c of calls) for (const id of JSON.stringify(c.body ?? "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []) ids.add(id);
    for (const id of ids) if (id !== albumId) {
      const res = await viewer.request.head(`${api(`/assets/${id}/thumbnail`)}?key=${encodeURIComponent(new URL(link).pathname.split("/").pop())}`);
      if (res.ok()) await appGet(`photo ${id}`, "GET", `/assets/${id}`);
    }
    journey.recorder.attach({ name: "viewer-app-responses.json", body: JSON.stringify(calls, null, 2), kind: "capture", tags: { user: "viewer" } });
  });

  await journey.check("app-gets-photo", { by: "viewer", caption: "Checking that the app gets exactly the one photo in the album." }, async () => {
    const photos = new Set(calls.flatMap((c) => {
      const b = c.body;
      if (c.call.startsWith("search")) return (b?.assets?.items ?? []).map((a) => a.id);
      if (c.call.startsWith("timeline bucket")) return b?.id ?? [];
      if (c.call.startsWith("photo ")) return b?.id ? [b.id] : [];
      return [];
    }));
    const got = [...photos];
    const ok = got.length === 1 && got[0] === photoId;
    return {
      passed: ok,
      proof: "Listed every photo id the app got back with only the link.",
      evidence: [{ source: "api", login: "viewer", url: api("/search/metadata"), got: { photo_ids: got, expected: [photoId], calls: calls.map((c) => `${c.method} ${c.path} -> ${c.status}`) } }],
      reason: `The app got photo ids ${JSON.stringify(got)}, expected only ${photoId}.`,
      caption: ok ? "the app gets the one photo." : `the app gets ${got.length} photos.`,
    };
  });

  await journey.check("app-hides-details", { by: "viewer", caption: "Checking that nothing the app gets shows the location, camera or file name." }, async () => {
    const found = calls.flatMap((c) => leaks(c.body).map((l) => ({ call: `${c.method} ${c.path}`, field: l })));
    const ok = found.length === 0;
    const where = [...new Set(found.map((f) => f.call))];
    return {
      passed: ok,
      proof: `Read every response the app got with only the link (${calls.length} calls, saved in viewer-app-responses.json) and looked for the photo's location, camera and file name.`,
      evidence: [{ source: "api", login: "viewer", url: api("/search/metadata"), got: ok ? { hidden_details_found: 0, calls: calls.map((c) => `${c.method} ${c.path} -> ${c.status}`) } : { hidden_details_found: found.length, found } }],
      reason: `With only the link, the app got ${found.length} hidden details from ${where.join("; ")}: ${found.slice(0, 6).map((f) => f.field).join("; ")}.`,
      caption: ok ? "the app gets none of the hidden details." : `the app gets the location and camera from ${where.join(", ")}.`,
    };
  });
});
