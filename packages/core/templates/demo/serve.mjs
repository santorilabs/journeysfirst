// journeysfirst example. Serves demo/index.html for the starter journey.
// Delete this file when you point Playwright at your app.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT ?? 4321);
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.html"));
createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}).listen(port, () => {
  console.log(`example page on http://127.0.0.1:${port}`);
});
