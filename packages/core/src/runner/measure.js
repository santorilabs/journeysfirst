// Measures each user's screen after a line, for a review of the run (the
// journey-review skill). It reads computed styles and event times, so two
// measurements of one screen agree. Only playwright.js uses it.
//   measure-<line>.txt: {url, wide, phone, actions}
// wide and phone are the screen at the run's width and at 375 px.
// actions are the clicks of that line, each with the ms until the page first
// changed.

/** The width the phone half is measured at, in px. */
export const PHONE_WIDTH = 375;
/** The name the page calls to report an action, a change or a paint. */
export const WATCH_BINDING = "__journeysfirstSaw";

/**
 * @typedef {{kind: "action", at: number, name: string} | {kind: "change", at: number, text: string}
 *   | {kind: "paint", at: number, ms: number, path: string} | {kind: "field", at: number, name: string}} Seen
 *   what a page reported, with its clock in ms
 * @typedef {{name: string, ms?: number|null, changed?: string, field?: true}} ActionTime a click, with ms to the first
 *   change (null when the page never changed), or a field the user filled or set (field: true, no ms)
 * @typedef {{take: () => Promise<ActionTime[]>, forget: () => void}} Watch
 * @typedef {import("@playwright/test").Page} Page
 */

/**
 * Runs in the page. Everything it returns is a number or a word read from the
 * page: nothing here judges it.
 *   spacing, type, fonts, radius, effects: each value in use, with how many elements have it and the first one.
 *   controls: each link, button and field, with its box, its fill and the region it sits in (a dialog, a form, the header).
 *     small: under 24 px in a direction (WCAG 2.2 target size). A text field, and a link or button that is only words
 *       (no fill, no border), are never marked.
 *     strong: a button whose fill has a contrast of 3 or more with the background behind it.
 *   cut: a dialog or fixed panel that runs off the side of the screen.
 *   text: a short hash of the words on the screen, so a later run can tell whether they changed.
 */
export function measurePage() {
  const round = (/** @type {string|number} */ v) => Math.round(typeof v === "number" ? v : parseFloat(v));
  const box = (/** @type {Element} */ e) => e.getBoundingClientRect();
  const words = (/** @type {unknown} */ text) => String(text ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
  const name = (/** @type {any} */ e) => {
    const said = words(e.innerText) || words(e.getAttribute("aria-label")) || words(e.closest("label")?.innerText) || words(e.getAttribute("placeholder")) || words(e.value);
    return said ? `${e.tagName.toLowerCase()} "${said}"` : e.tagName.toLowerCase() + (e.id ? `#${e.id}` : "");
  };
  const styles = new Map();
  const style = (/** @type {Element} */ e) => styles.get(e) ?? styles.set(e, getComputedStyle(e)).get(e);
  const shown = new Set([document.body, ...document.body.querySelectorAll("*")].filter((e) => box(e).width > 0 && box(e).height > 0 && style(e).visibility !== "hidden"));
  const hasText = (/** @type {Element} */ e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim());
  // Any CSS color as [r, g, b, alpha], read back from a canvas.
  const paint = /** @type {CanvasRenderingContext2D} */ (document.createElement("canvas").getContext("2d", { willReadFrequently: true }));
  const rgba = (/** @type {string} */ color) => {
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = color;
    paint.fillRect(0, 0, 1, 1);
    return [...paint.getImageData(0, 0, 1, 1).data];
  };
  const light = (/** @type {number[]} */ c) => c.slice(0, 3).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  // The color behind an element: the first fill that is not clear, going up. White when there is none.
  const behind = (/** @type {Element|null} */ e) => {
    for (; e; e = e.parentElement) if (rgba(style(e).backgroundColor)[3] > 0) return rgba(style(e).backgroundColor);
    return [255, 255, 255, 255];
  };
  const contrast = (/** @type {number[]} */ a, /** @type {number[]} */ b) => (Math.max(light(a), light(b)) + 0.05) / (Math.min(light(a), light(b)) + 0.05);
  /** @type {Record<string, Record<string, {n: number, on: string}>>} */
  const values = { spacing: {}, type: {}, fonts: {}, radius: {}, effects: {} };
  const add = (/** @type {string} */ kind, /** @type {Set<string>} */ keys, /** @type {Element} */ e) => {
    for (const key of keys) (values[kind][key] ??= { n: 0, on: name(e) }).n += 1;
  };
  const sides = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "rowGap", "columnGap"];
  const regions = [...document.querySelectorAll("dialog, [role=dialog], [aria-modal=true], form, header, nav, aside, footer, main")].filter((e) => shown.has(e));
  // "dialog", or "form 2" for the second form on the screen, so two forms are never counted as one.
  const regionName = (/** @type {Element|null} */ region) => {
    if (!region) return "page";
    const kind = region.getAttribute("role") || region.tagName.toLowerCase();
    const same = regions.filter((r) => (r.getAttribute("role") || r.tagName.toLowerCase()) === kind);
    return same.length > 1 ? `${kind} ${same.indexOf(region) + 1}` : kind;
  };
  /** @type {object[]} */
  const controls = [];
  /** @type {object[]} */
  const cut = [];
  for (const e of shown) {
    const s = style(e);
    // Over 96 px is layout (a centered column's side margins), not the scale.
    add("spacing", new Set(sides.map((side) => round(s[/** @type {any} */ (side)])).filter((v) => v > 0 && v <= 96).map(String)), e);
    if (hasText(e)) {
      add("type", new Set([String(round(s.fontSize))]), e);
      add("fonts", new Set([s.fontFamily.split(",")[0].replace(/"/g, "").trim()]), e);
    }
    const corner = s.borderTopLeftRadius;
    if (parseFloat(corner) > 0) add("radius", new Set([corner.includes("%") ? corner.split(" ")[0] : String(round(corner))]), e);
    const effects = new Set();
    if (s.backgroundImage.includes("gradient")) effects.add(`gradient: ${s.backgroundImage.slice(0, 80)}`);
    // Tailwind writes shadows whose every color is clear. Nobody sees those.
    if (s.boxShadow !== "none" && /rgba?\(/.test(s.boxShadow.replace(/rgba\([^)]*,\s*0\)/g, ""))) effects.add(`shadow: ${s.boxShadow}`);
    if (e.children.length === 0 && /\p{Extended_Pictographic}/u.test(e.textContent ?? "")) effects.add(`emoji: ${words(e.textContent).slice(0, 10)}`);
    add("effects", effects, e);

    if (e.matches("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=switch], [role=tab], [role=menuitem]")) {
      const r = box(e.closest("label") || e);
      const region = regions.filter((candidate) => candidate.contains(e)).pop() ?? null;
      const fill = rgba(s.backgroundColor);
      const onlyWords = e.matches("a, button, [role=button], [role=link]") && words(/** @type {any} */ (e).innerText) !== "" && fill[3] === 0 && parseFloat(s.borderTopWidth) === 0 && parseFloat(s.borderBottomWidth) === 0;
      const textField = e.matches("textarea, input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=range], [type=color], [type=file])");
      const small = !onlyWords && !textField && (r.width < 24 || r.height < 24);
      const strong = e.matches("button, a, [role=button], input[type=submit], input[type=button]") && fill[3] === 255 && contrast(fill, behind(e.parentElement)) >= 3;
      controls.push({ name: name(e), in: regionName(region), left: round(r.left), top: round(r.top), width: round(r.width), height: round(r.height), fill: s.backgroundColor, ...(small ? { small } : {}), ...(strong ? { strong } : {}) });
    }
    if ((e.matches("dialog, [role=dialog], [aria-modal=true]") || s.position === "fixed") && box(e).right > 0 && box(e).left < innerWidth && (box(e).left < -1 || box(e).right > innerWidth + 1)) {
      cut.push({ name: name(e), left: round(box(e).left), width: round(box(e).width) });
    }
  }
  let hash = 2166136261;
  for (const char of document.body.innerText) hash = Math.imul(hash ^ /** @type {number} */ (char.codePointAt(0)), 16777619) >>> 0;
  return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, text: hash.toString(16), ...values, controls, cut };
}

/**
 * Runs in every document a user opens. It reports each click on a control,
 * the first change to the page after it, and the document's first paint.
 * A change is a change to the DOM inside body, so a button that only copies
 * something and shows nothing reports no change. It also reports each field
 * the user fills or sets, so a review can count them.
 * @param {string} binding
 */
export function watchPage(binding) {
  if (window.top !== window) return;
  const send = (/** @type {object} */ seen) => {
    try {
      /** @type {any} */ (window)[binding]?.(seen);
    } catch {
      // The page is closing. Nothing to report to.
    }
  };
  const words = (/** @type {any} */ node) => ((node?.nodeType === 3 ? node.textContent : node?.innerText) ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  let waiting = false;
  new MutationObserver((records) => {
    if (!waiting) return;
    const first = records.find((r) => document.body?.contains(r.target));
    if (!first) return;
    waiting = false;
    const target = /** @type {Element} */ (first.target);
    send({ kind: "change", at: Date.now(), text: first.type === "attributes" ? `${first.attributeName} on ${target.tagName.toLowerCase()}` : words(first.addedNodes[0]) || words(target) });
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const acted = (/** @type {string} */ name) => {
    waiting = true;
    send({ kind: "action", at: Date.now(), name });
  };
  addEventListener("click", (event) => {
    const control = /** @type {any} */ (event.target)?.closest?.("button, a[href], summary, [role=button], [role=link], [role=tab], [role=menuitem], input[type=submit], input[type=button]");
    if (event.isTrusted && control) acted(words(control) || control.getAttribute("aria-label") || control.value || control.tagName.toLowerCase());
  }, true);
  addEventListener("keydown", (event) => {
    const field = /** @type {any} */ (event.target);
    if (event.isTrusted && event.key === "Enter" && field?.matches?.("input, textarea")) acted(`Enter in ${words(field.closest("label")) || field.getAttribute("aria-label") || field.getAttribute("placeholder") || field.name || "a field"}`);
  }, true);
  addEventListener("change", (event) => {
    const field = /** @type {any} */ (event.target);
    if (event.isTrusted && field?.matches?.("input, select, textarea")) send({ kind: "field", at: Date.now(), name: words(field.closest("label")) || field.getAttribute("aria-label") || field.getAttribute("placeholder") || field.name || "a field" });
  }, true);
  new PerformanceObserver((list) => {
    const paint = list.getEntriesByName("first-contentful-paint")[0];
    if (paint && location.protocol !== "about:") send({ kind: "paint", at: performance.timeOrigin + paint.startTime, ms: paint.startTime, path: location.pathname });
  }).observe({ type: "paint", buffered: true });
}

/**
 * What a page reported, as one time for each action. A click that opened a new
 * page is timed to that page's first paint. A page opened another way (the
 * script went to its url) is its own line, "open /path". Paints are paired
 * within one journey line only, so a click that showed nothing is not credited
 * with a page the next line opened.
 * @param {Seen[]} seen in the order reported
 * @returns {ActionTime[]}
 */
export function actionTimes(seen) {
  /** @type {ActionTime[]} */
  const times = [];
  /** @type {{time: ActionTime, at: number} | null} */
  let open = null;
  for (const event of seen) {
    if (event.kind === "action") {
      open = { time: { name: event.name, ms: null }, at: event.at };
      times.push(open.time);
    } else if (event.kind === "field") {
      times.push({ name: event.name, field: true });
    } else if (open && open.time.ms === null) {
      open.time.ms = Math.max(0, Math.round(event.at - open.at));
      open.time.changed = event.kind === "paint" ? `opened ${event.path}` : event.text;
    } else if (event.kind === "paint") {
      times.push({ name: `open ${event.path}`, ms: Math.round(event.ms) });
    }
  }
  return times;
}

/** How long a line's last click is given to show a change after the script moved on, in ms. */
export const LAST_CLICK_GRACE = 300;

/**
 * Start watching a user's pages. take gives the actions since the last take
 * or forget. A script often goes on as soon as the response arrives, a few ms
 * before the page shows it. So when the last click has no change yet, take
 * waits a moment before it answers. forget drops what was seen so far.
 * @param {import("@playwright/test").BrowserContext} context
 * @param {number} [grace] ms
 * @returns {Promise<Watch>}
 */
export async function watchActions(context, grace = LAST_CLICK_GRACE) {
  /** @type {Seen[]} */
  let seen = [];
  await context.exposeBinding(WATCH_BINDING, (_source, /** @type {Seen} */ event) => void seen.push(event));
  await context.addInitScript(watchPage, WATCH_BINDING);
  return {
    take: async () => {
      if (grace > 0 && actionTimes(seen).at(-1)?.ms === null) await new Promise((done) => setTimeout(done, grace));
      const times = actionTimes(seen);
      seen = [];
      return times;
    },
    forget: () => void (seen = []),
  };
}

/**
 * Delay each data request (fetch and XHR) a user's pages make, so a screen
 * that shows nothing while it waits can be told from one that shows it is
 * loading. Documents, scripts and styles are not delayed: a blank browser
 * says nothing about the product.
 * @param {import("@playwright/test").BrowserContext} context
 * @param {number} ms
 */
export async function delayData(context, ms) {
  await context.route("**/*", async (route) => {
    if (["fetch", "xhr"].includes(route.request().resourceType())) await new Promise((done) => setTimeout(done, ms));
    await route.fallback();
  });
}

/**
 * The screen at the run's width and, unless phone is false, at 375 px. The
 * page is set back to its own width after.
 * @param {Page} page
 * @param {{phone?: boolean}} [options]
 */
export async function measureScreen(page, { phone = true } = {}) {
  const wide = await page.evaluate(measurePage);
  const size = page.viewportSize();
  if (!phone || !size || size.width <= PHONE_WIDTH) return { wide };
  await page.setViewportSize({ width: PHONE_WIDTH, height: size.height });
  try {
    return { wide, phone: await page.evaluate(measurePage) };
  } finally {
    await page.setViewportSize(size);
  }
}

/**
 * The lines a slow replay prints: each action and how long the page took to
 * show anything, with data requests delayed.
 * @param {number} delay ms
 * @param {Array<{line: number, user: string, actions: ActionTime[]}>} lines
 */
export function slowReport(delay, lines) {
  const said = lines.filter((l) => l.actions.some((a) => !a.field)).map((l) => `line ${l.line} (${l.user}): ${l.actions.filter((a) => !a.field).map((a) => `"${a.name}" ${a.ms === null ? "no change" : `${a.ms} ms`}`).join(", ")}`);
  return [`journeysfirst: slow replay, each data request delayed ${delay} ms. No run was written.`, ...(said.length ? said : ["No action or page was timed."])].join("\n");
}
