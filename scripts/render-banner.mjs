// Renders assets/banner.html to assets/banner.png at 2x (2400 by 840).
//
//   node scripts/render-banner.mjs
import { chromium } from "playwright"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const html = join(root, "assets", "banner.html")
const out = join(root, "assets", "banner.png")

// Prefer Playwright's browser. Fall back to the machine's Chrome when that
// browser has not been downloaded.
let browser
try {
  browser = await chromium.launch()
} catch {
  try {
    browser = await chromium.launch({ channel: "chrome" })
  } catch {
    console.error("Could not start a browser. Install Chrome, or run: npx playwright install --only-shell chromium")
    process.exit(1)
  }
}
const page = await browser.newPage({
  viewport: { width: 1200, height: 420 },
  deviceScaleFactor: 2,
})
await page.goto(pathToFileURL(html).href)
await page.evaluate(() => document.fonts.ready)

const ready = await page.evaluate(() => {
  const mark = document.querySelector(".mark")
  return {
    font: document.fonts.check('500 56px "Schibsted Grotesk"'),
    logo: mark instanceof HTMLImageElement && mark.complete && mark.naturalWidth > 0,
  }
})
if (!ready.font || !ready.logo) {
  console.error("The banner is missing a font or the logo.", ready)
  console.error("Schibsted Grotesk is in assets/fonts. The logo is assets/mark.svg.")
  await browser.close()
  process.exit(1)
}

// A block box stays inside the page even when its text spills out, so measure
// the glyphs.
const overflow = await page.evaluate(() => {
  const box = document.body.getBoundingClientRect()
  return [...document.querySelectorAll("h1, p, .mark")].flatMap((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const r = range.getBoundingClientRect()
    if (r.width === 0) return []
    const outside = r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1
    return outside ? [`${el.textContent.trim().slice(0, 90)} (${Math.round(r.right)} > ${Math.round(box.right)})`] : []
  })
})
if (overflow.length) {
  console.error("Text runs outside the banner. Shorten the line or lower the type size.")
  for (const line of overflow) console.error(`- ${line}`)
  await browser.close()
  process.exit(1)
}

await page.screenshot({ path: out, type: "png" })
await browser.close()
console.log(out)
