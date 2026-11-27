// A tiny demo app where a billing reviewer opens a claim, reads its billing
// code and approves it. State lives in memory; restart resets it.
// DEMO_MOVED_FIELD=1 plants a change on purpose: the billing code moves from
// the claim's first screen to Details, then Billing. Nothing breaks, so every
// check still passes. The example uses it to show a run that got worse.
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4322);
const MOVED = Boolean(process.env.DEMO_MOVED_FIELD);
let approved = false;

const STYLE = `<style>
body{font-family:system-ui,sans-serif;margin:40px;color:#141516}
.card{border:1px solid #e6e6e3;border-radius:16px;padding:24px;max-width:480px}
button,a.claim{font:inherit;padding:10px 16px;border-radius:10px;border:1px solid #141516;background:#fff;color:inherit;cursor:pointer;text-decoration:none;display:inline-block}
label{display:block;margin:16px 0}input{font:inherit;padding:10px;border:1px solid #e6e6e3;border-radius:10px;display:block;margin-top:8px}
#status{color:#6b6d69}
</style>`;
const CODE = '<label>Billing code <input readonly value="4471-B"></label>';
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${STYLE}</head><body>${body}</body></html>`;
const LIST = page("Claims", '<h1>Claims to review</h1><p><a class="claim" href="/claims/1042">Claim 1042</a></p>');
const claim = () => page("Claim 1042", `<h1>Claim 1042</h1>
<div class="card"><p>Knee X-ray, 2 views. Billed $184.00.</p>
${MOVED ? '<p><button id="details">Details</button></p><div id="more" hidden><p>Seen Nov 3 by Dr. Okafor.</p><p><button id="billing">Billing</button></p><div id="code" hidden>' + CODE + "</div></div>" : CODE}
<p><button id="approve">Approve</button> <span id="status">${approved ? "Approved" : "Waiting for review"}</span></p></div>
<script>
document.getElementById("approve").onclick = async () => {
  await fetch("/api/approve", { method: "POST" });
  document.getElementById("status").textContent = "Approved";
};
document.getElementById("details")?.addEventListener("click", () => { document.getElementById("more").hidden = false; });
document.getElementById("billing")?.addEventListener("click", () => { document.getElementById("code").hidden = false; });
</script>`);

const server = createServer((req, res) => {
  if (req.url === "/api/reset" && req.method === "POST") approved = false;
  if (req.url === "/api/approve" && req.method === "POST") approved = true;
  if (req.url.startsWith("/api/")) return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ approved }));
  const body = req.url === "/" ? LIST : req.url === "/claims/1042" ? claim() : null;
  if (!body) return void res.writeHead(404).end("Not found");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
});
// PORT=0 takes any free port. The line below names the real one.
server.listen(PORT, () => console.log(`demo app on http://localhost:${server.address().port}${MOVED ? " (with the billing code moved)" : ""}`));
