// The frame every review page sits in: the header bar that says where the
// page is, the page's own content, and the footer.
import { esc } from "../shared/display.js";
import { VERSION } from "../shared/version.js";
import { PAGE_CSS } from "./style.js";
import { FONTS, MARK } from "./tokens.js";

/**
 * @param {string} heading
 * @param {string} body
 * @param {Array<{text: string, href?: string}>} path where this page is, for the header bar. The last one is this page.
 * @param {boolean} [fit] the page fills one screen and its panels scroll, where a page otherwise scrolls as a whole
 */
export function layout(heading, body, path, fit = false) {
  const crumbs = path.map(({ text, href }, i) => (href ? `<a href="${esc(href)}">${esc(text)}</a>` : `<span${i === path.length - 1 ? ' aria-current="page"' : ""}>${esc(text)}</span>`)).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(heading)}</title>
${FONTS}<style>${PAGE_CSS}</style></head><body${fit ? ' class="fit"' : ""}><div class="frame"><header class="bar"><span class="logo">${MARK}</span>${crumbs}</header><main>${body}</main><footer class="foot"><span>Santori Labs</span><span>journeysfirst ${VERSION}</span></footer></div></body></html>`;
}
