// The facts a review reads from a run's measure files.
import assert from "node:assert/strict";
import { test } from "node:test";
import { measuredFacts, valuesUsed } from "../src/review/measured.js";

const tally = (...values) => Object.fromEntries(values.map((v) => [v, { n: 1, on: 'button "Share"' }]));
/** A measured screen with the example app's values, changed by `over`. */
const screen = (over = {}) => ({ width: 1280, pageWidth: 1280, spacing: tally("10", "16"), type: tally("16"), fonts: tally("system-ui"), radius: tally("10"), effects: {}, controls: [], cut: [], ...over });
const measure = (over = {}) => ({ url: "http://localhost:4321/", wide: screen(), phone: screen({ width: 375, pageWidth: 375 }), actions: [], ...over });
const says = (result) => result.facts.map((f) => `${f.ask ? "ask" : "fact"} ${f.criterion} ${f.step}: ${f.says}`);

test("a clean screen gives no fact, and its clicks and fields are counted", () => {
  const actions = [{ name: "open /", ms: 20 }, { name: "Share", ms: 12, changed: "open on dialog" }, { name: "Anyone with the link can view", field: true }];
  const result = measuredFacts({ lines: new Map([[1, measure({ actions })]]) });
  assert.deepEqual(result.facts, []);
  assert.deepEqual(result.counts, ["step 1: 1 click, 1 field"]);
  assert.deepEqual(result.notMeasured, []);
});

test("a click that changed nothing, and one that showed nothing for a second, are each a fact", () => {
  const actions = [{ name: "Copy link", ms: null }, { name: "Share", ms: 2017, changed: "open on dialog" }, { name: "Done", ms: 999, changed: "open on dialog" }];
  assert.deepEqual(says(measuredFacts({ lines: new Map([[1, measure({ actions })]]) })), [
    'fact intuitive-feedback 1: Nothing on the screen changes after "Copy link".',
    'fact simple-fast 1: "Share" shows nothing for 2017 ms.',
  ]);
});

test("two buttons that stand out in one dialog or form are a fact, once; in the page or in two forms they are not", () => {
  const button = (name, region) => ({ name: `button "${name}"`, in: region, width: 80, height: 40, strong: true });
  const two = measure({ wide: screen({ controls: [button("Copy link", "dialog"), button("Done", "dialog"), button("Send", "main"), button("Import", "main")] }) });
  const apart = measure({ wide: screen({ controls: [button("Sign in", "form 1"), button("Search", "form 2")] }) });
  assert.deepEqual(says(measuredFacts({ lines: new Map([[1, two], [2, two], [3, apart]]) })), ['fact simple-one-action 1: The dialog has 2 buttons that stand out: button "Copy link", button "Done".']);
});

test("a line that takes more clicks or fields than in the earlier run is a fact", () => {
  const earlier = new Map([[5, measure({ actions: [{ name: "Anyone with the link can view", field: true }] })]]);
  const lines = new Map([[5, measure({ actions: [{ name: "Anyone with the link can view", field: true }, { name: "Turn off", ms: 8, changed: "open on dialog" }] })]]);
  assert.deepEqual(says(measuredFacts({ lines, earlier })), ["fact simple-no-longer 5: This line takes 1 click and 1 field. In the earlier run it took 0 clicks and 1 field."]);
  assert.deepEqual(says(measuredFacts({ lines: earlier, earlier: lines })), [], "fewer is fine");
  const same = measure({ wide: screen({ text: "a1" }), actions: [{ name: "open /", ms: 20 }] });
  const reworded = measure({ wide: screen({ text: "b2" }) });
  assert.deepEqual(measuredFacts({ lines: new Map([[1, same], [2, reworded], [5, lines.get(5)]]), earlier: new Map([[1, measure({ wide: screen({ text: "a1" }) })], [2, same], [5, earlier.get(5)]]) }).differ, [2, 5], "a screen differs when its words, controls, values or actions do");
});

test("a value is new when the earlier run's same line did not have it", () => {
  const changed = measure({ wide: screen({ spacing: tally("10", "11", "16"), radius: tally("4", "10"), effects: tally("gradient: linear-gradient(red, blue)") }) });
  const withEarlier = measuredFacts({ lines: new Map([[1, changed], [2, changed]]), earlier: new Map([[1, measure()], [2, measure()]]) });
  assert.deepEqual(says(withEarlier), ['fact foundation-values 1: New since the earlier run: spacing 11 px on button "Share"; radius 4 px on button "Share"; gradient: linear-gradient(red, blue) on button "Share".']);
  assert.deepEqual(says(measuredFacts({ lines: new Map([[1, changed]]) })), [], "with no earlier run there is nothing to call new: a review checks the values against the design system the README links to");
});

test("the values a run uses are listed once, sorted", () => {
  const lines = new Map([[1, measure({ wide: screen({ spacing: tally("24", "3", "10"), radius: tally("16", "50%") }) })]]);
  assert.equal(valuesUsed(lines), "Spacing 3, 10, 16, 24 px. Type 16 px. Font system-ui. Radius 10, 16, 50% px.");
});

test("at 375 px: a page that scrolls sideways, a dialog cut off, and a small control the journey uses are facts, each once", () => {
  const controls = [
    { name: 'input "Anyone with the link can view"', in: "dialog", width: 237, height: 18, small: true },
    { name: 'button "next"', in: "page", width: 22, height: 28, small: true },
  ];
  const phone = screen({ width: 375, pageWidth: 412, controls, cut: [{ name: "dialog", left: 0, width: 387 }] });
  const actions = [{ name: "Anyone with the link can view", field: true }];
  const lines = new Map([[1, measure({ phone, actions })], [5, measure({ phone, actions })]]);
  assert.deepEqual(says(measuredFacts({ lines })), [
    "fact foundation-phone 1: At 375 px the page is 412 px wide, so it scrolls sideways.",
    'fact foundation-phone 1: At 375 px: dialog is 387 px wide and runs off the screen. input "Anyone with the link can view" is 237 by 18 px. A control needs 24 px each way.',
  ]);
  const wideOnly = measuredFacts({ lines: new Map([[1, measure({ phone: undefined })]]) });
  assert.deepEqual(wideOnly.notMeasured, ["foundation-phone on step 1: the run did not measure at 375 px"]);
});
