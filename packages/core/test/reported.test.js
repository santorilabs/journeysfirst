// What the app reported when a run fails: the report's sentence, its limits,
// its masking, and the Markdown the journey-fix skill reads.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MOST_ITEMS, failureMarkdown, failureReport, requestPath, screenOutline, summarize, withoutQueries } from "../src/runner/reported.js";

const none = (/** @type {string} */ text) => text;

test("a request path keeps no query or fragment, and keeps its origin only when it is not the page's", () => {
  assert.equal(requestPath("http://app.test/api/doc/7?token=abc#x", "http://app.test/view"), "/api/doc/7");
  assert.equal(requestPath("https://api.other.test/v1/doc?key=abc", "http://app.test/view"), "https://api.other.test/v1/doc");
  assert.equal(requestPath("http://app.test/api/doc", undefined), "http://app.test/api/doc", "with no page to compare to, the origin stays");
});

test("the sentence names a failed request at the failing line first, then an earlier one, then a console error", () => {
  const users = [
    { user: "viewer", requests: [{ line: 2, method: "GET", path: "/api/doc", status: 500 }], errors: [{ line: 3, text: "boom" }], outline: null },
    { user: "you", requests: [{ line: 3, method: "POST", path: "/api/share", status: 403 }], errors: [], outline: null },
  ];
  assert.equal(summarize(users, 3, 2), "You got a 403 from POST /api/share at this line.", "a request at this line wins over an earlier one");
  assert.equal(summarize([users[0]], 3, 2), "The viewer got a 500 from GET /api/doc at line 2.");
  assert.equal(summarize([{ ...users[0], requests: [] }], 3, 2), "The viewer's page logged an error at this line.");
  assert.equal(summarize([{ user: "you", requests: [], errors: [], outline: null }], 3, 3), "No user got a failed request or a console error at this line.");
  assert.equal(summarize([{ user: "you", requests: [], errors: [], outline: null }], 3, 1), "No user got a failed request or a console error from line 1 to this line.");
  assert.equal(summarize([{ user: "you", requests: [{ line: null, method: "GET", path: "/me", status: 401 }], errors: [], outline: null }], 1, 1), "You got a 401 from GET /me before the first line.");
});

test("the report puts the line's user first and keeps the last few requests and errors, with a count of the rest", () => {
  const many = Array.from({ length: MOST_ITEMS + 3 }, (_, i) => ({ line: 1, method: "GET", path: `/api/${i}`, status: 404 }));
  const report = failureReport({
    line: 2,
    says: "The viewer sees the doc.",
    by: "viewer",
    since: 1,
    users: [
      { user: "you", requests: many, errors: [], outline: "- heading \"Home\"" },
      { user: "viewer", requests: [], errors: [{ line: 2, text: "first line\nsecond line" }], outline: null },
    ],
    redact: none,
  });
  assert.deepEqual(report.users.map((u) => u.user), ["viewer", "you"]);
  assert.equal(report.users[1].requests.length, MOST_ITEMS);
  assert.equal(report.users[1].requests.at(-1)?.path, `/api/${MOST_ITEMS + 2}`, "the newest are kept");
  assert.deepEqual(report.users[1].more, { requests: 3 });
  assert.equal(report.users[0].errors[0].text, "first line", "only an error's first line is kept");
  assert.equal(report.users[0].outline, null, "an outline that was not captured stays null");
});

test("every text in the report is redacted and masked: the line, the paths, the errors and the outline", () => {
  const secret = "sec-9f8e7d6c";
  const redact = (/** @type {string} */ text) => text.replaceAll(secret, "${code}");
  const report = failureReport({
    line: 1,
    says: `Open /doc/${secret}`,
    by: "you",
    since: 1,
    users: [{ user: "you", requests: [{ line: 1, method: "GET", path: `/doc/${secret}`, status: 403 }], errors: [{ line: 1, text: "sent Bearer abcdefghijklmnop" }], outline: `- text: ${secret}` }],
    redact,
  });
  const text = JSON.stringify(report) + failureMarkdown(report);
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes("abcdefghijklmnop"), false);
  assert.match(report.users[0].errors[0].text, /Bearer ••••/);
  assert.equal(report.users[0].requests[0].path, "/doc/${code}");
});

test("the Markdown starts with the line and the sentence, and gives each user their requests, errors and screen", () => {
  const report = failureReport({
    line: 4,
    says: "The viewer sees \"Q3 plan\".",
    by: "viewer",
    since: 3,
    users: [
      { user: "viewer", requests: [{ line: 3, method: "GET", path: "/api/view/q3-plan", status: 403 }], errors: [{ line: 3, text: "Failed to load resource: 403" }], outline: "- heading \"You don't have access\" [level=1]" },
      { user: "you", requests: [], errors: [], outline: null },
    ],
    redact: none,
  });
  const md = failureMarkdown(report);
  assert.match(md, /^# What the app reported at line 4\n\nLine 4 \(viewer\): The viewer sees "Q3 plan"\.\n\nThe viewer got a 403 from GET \/api\/view\/q3-plan at line 3\.\n/);
  assert.match(md, /This covers lines 3 to 4, for every user\./);
  assert.match(md, /## Viewer\n\nFailed requests:\n\n- line 3: 403 GET \/api\/view\/q3-plan\n\nConsole errors:\n\n- line 3: Failed to load resource: 403\n/);
  assert.match(md, /```yaml\n- heading "You don't have access" \[level=1\]\n```/);
  assert.match(md, /## You\n\nNo failed requests or console errors\.\n\nWhat you saw on screen at line 4:\n\nNot captured\.\n$/);
});

test("with Playwright before 1.49 there is no screen outline, and nothing else is asked of the page", async () => {
  let asked = 0;
  const page = /** @type {any} */ ({ locator: () => ({}), isClosed: () => false, evaluate: async () => void (asked += 1) });
  assert.equal(await screenOutline(page, []), null);
  assert.equal(asked, 0);
});

test("no web address in the report keeps its query or fragment: not a link on screen, not a URL in a console error", () => {
  assert.equal(withoutQueries("- /url: https://app.test/join?invite=Zq81kLm09xYp#top"), "- /url: https://app.test/join");
  assert.equal(withoutQueries('GET "http://a.test/x?code=1" failed'), 'GET "http://a.test/x" failed');
  assert.equal(withoutQueries("  - /url: /join?invite=Zq81kLm09xYp"), "  - /url: /join");
  const report = failureReport({
    line: 1,
    says: "Open the invite.",
    by: "you",
    since: 1,
    users: [{ user: "you", requests: [], errors: [{ line: 1, text: "Failed to load https://app.test/api?sig=abc123" }], outline: '- link "Join":\n  - /url: https://app.test/join?invite=Zq81kLm09xYp' }],
    redact: none,
  });
  const text = JSON.stringify(report) + failureMarkdown(report);
  assert.equal(text.includes("Zq81kLm09xYp"), false);
  assert.equal(text.includes("abc123"), false);
});

test("a frozen page gets no outline, and the capture does not wait for it", async () => {
  const page = /** @type {any} */ ({ locator: () => ({ ariaSnapshot: async () => "- main" }), isClosed: () => false, evaluate: () => new Promise(() => {}) });
  const started = Date.now();
  assert.equal(await screenOutline(page, [], 50), null);
  assert.ok(Date.now() - started < 1000);
});
