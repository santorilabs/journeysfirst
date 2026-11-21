// A tiny demo app with a link-sharing flow, so the example journey runs against
// a real app. State lives in memory; restart resets it.
// DEMO_LINK_BUG=1 adds a bug on purpose: once shared, the link keeps working
// after sharing is turned off. The example uses it to show a failing run.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 4321);
const BUG = Boolean(process.env.DEMO_LINK_BUG);
const pages = {
  "/": readFileSync(new URL("./owner.html", import.meta.url)),
  "/view/q3-plan": readFileSync(new URL("./viewer.html", import.meta.url)),
};
const SIGNED_OUT = "<!doctype html><title>Sign in</title><h1>Sign in</h1><p>Only the owner can share this presentation.</p>";
let linkSharing = false;
let everShared = false;

const server = createServer((req, res) => {
  // A one-time sign-in link for the owner. Everyone else is signed out.
  if (req.url === "/signin/owner") {
    res.writeHead(302, { "set-cookie": "session=owner; Path=/; HttpOnly", location: "/" }).end();
    return;
  }
  const owner = /(^|;\s*)session=owner(;|$)/.test(req.headers.cookie ?? "");
  if (req.url.startsWith("/api/share") && !owner) return json(res, { error: "Sign in as the owner." }, 403);
  if (req.url === "/" && !owner) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(SIGNED_OUT);
    return;
  }
  if (req.url === "/api/share" && req.method === "GET") return json(res, { linkSharing });
  if (req.url === "/api/share" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      linkSharing = Boolean(JSON.parse(body || "{}").linkSharing);
      everShared ||= linkSharing;
      json(res, { linkSharing });
    });
    return;
  }
  if (req.url === "/api/view/q3-plan" && req.method === "GET") return json(res, { canView: linkSharing || (BUG && everShared) });
  if (req.url === "/api/reset" && req.method === "POST") {
    linkSharing = false;
    everShared = false;
    return json(res, { linkSharing });
  }
  const page = pages[req.url.split("?")[0]];
  if (!page) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
});
// PORT=0 takes any free port. The line below names the real one.
server.listen(PORT, () => console.log(`demo app on http://localhost:${server.address().port}${BUG ? " (with the link bug)" : ""}`));

function json(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}
