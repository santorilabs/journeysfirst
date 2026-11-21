// Caption words for journey videos. The fixture's use of them is in playwright.test.js.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CAPTION_CSS, CAPTION_LENGTH, actionsFor, captionHtml, captionSettings, captionText, fillValues, shortCaption } from "../src/runner/captions.js";

test("a caption is one sentence: the first one, cut at a word near 90 characters with an ellipsis", () => {
  assert.equal(shortCaption("You sign up with your email."), "You sign up with your email.");
  assert.equal(shortCaption("You sign up with the code. Then you wait for the email."), "You sign up with the code.");
  assert.equal(shortCaption("Is the project there? Reload and look again."), "Is the project there?");
  const long = shortCaption("You turn on link sharing, copy the link, paste it into a message and send it to the viewer by email.");
  assert.equal(long, "You turn on link sharing, copy the link, paste it into a message and send it to the viewer…");
  assert.ok(long.length <= CAPTION_LENGTH + 1);
  assert.equal(shortCaption("x".repeat(120)), `${"x".repeat(CAPTION_LENGTH)}…`);
  assert.equal(shortCaption("You open https://app.example.test/v1.2/p in a new tab."), "You open https://app.example.test/v1.2/p in a new tab.");
});

test("known values are filled in; secret and unknown ones stay as ${name}", () => {
  const values = { email: { value: "a@example.test" }, code: { secret: true }, empty: { value: null } };
  assert.equal(fillValues("Sign up with ${email}, ${code}, ${empty} and ${other}.", values), "Sign up with a@example.test, ${code}, ${empty} and ${other}.");
});

test("a written caption shows as is; a verdict word always comes first; the bar's text is escaped", () => {
  assert.equal(captionText({ by: "you", text: "You sign up with your email." }), "You sign up with your email.");
  assert.equal(captionText({ by: "you", text: "Checking that the new project shows in Your projects." }), "Checking that the new project shows in Your projects.");
  assert.equal(captionText({ by: "you", verdict: "failed", text: "the new project is not in Your projects." }), "Failed: the new project is not in Your projects.");
  assert.equal(captionText({ by: "you", verdict: "passed", text: "one sign-in email arrived." }), "Passed: one sign-in email arrived.");
  assert.equal(captionText({ by: "viewer", lead: "Viewer", text: "The viewer opens the link." }), "Viewer: The viewer opens the link.");
  assert.match(captionHtml({ by: "you", text: "<b>hi</b>" }, "you"), /&lt;b&gt;hi&lt;\/b&gt;/);
});

test("the test's captions option wins over the project's journeyCaptions; the bar is at the top unless one says bottom", () => {
  assert.deepEqual(captionSettings(undefined, undefined), { position: "top" });
  assert.deepEqual(captionSettings(true, undefined), { position: "top" });
  assert.deepEqual(captionSettings(undefined, { position: "bottom" }), { position: "bottom" });
  assert.deepEqual(captionSettings({ position: "top" }, { position: "bottom" }), { position: "top" });
  assert.deepEqual(captionSettings(true, { position: "bottom" }), { position: "bottom" });
  assert.equal(captionSettings(false, { position: "bottom" }), null);
  assert.equal(captionSettings(undefined, false), null);
  assert.deepEqual(captionSettings({ position: "bottom" }, false), { position: "bottom" });
  assert.throws(() => captionSettings(undefined, { position: "middle" }), /must be "top" or "bottom"/);
  assert.deepEqual([actionsFor("top"), actionsFor("bottom")], [{ position: "bottom-right" }, { position: "top-right" }]);
});

test("the bar is solid and large, with the verdict in a pill, styled by part names and never by a style attribute", () => {
  const html = captionHtml({ by: "you", verdict: "failed", text: "the link still opens Q3 plan." }, "you");
  assert.doesNotMatch(html, /style=/);
  assert.equal(html, '<div part="jf-bar jf-top jf-here"><span part="jf-pill jf-failed">Failed:</span> the link still opens Q3 plan.</div>');
  assert.equal(captionHtml({ by: "you", lead: "You", text: "x" }, "viewer", "bottom"), '<div part="jf-bar jf-bottom jf-away"><span part="jf-lead">You:</span> x</div>');
  // An unknown verdict gets the plain pill, never a part name made from its text.
  assert.match(captionHtml({ by: "you", verdict: "x y", text: "x" }, "you"), /<span part="jf-pill">/);
  assert.match(CAPTION_CSS, /\*::part\(jf-bar\)\{[^}]*background:#0d0e0f/);
  assert.doesNotMatch(CAPTION_CSS, /rgba|opacity/);
  assert.match(CAPTION_CSS, /clamp\(18px,2\.2vw,32px\)/);
  assert.match(CAPTION_CSS, /\*::part\(jf-failed\)\{background:#b0124f\}/);
  assert.ok(CAPTION_CSS.indexOf("jf-here") > CAPTION_CSS.indexOf("jf-top"), "the bright edge wins over the gray one");
});
