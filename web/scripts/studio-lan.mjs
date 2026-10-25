/**
 * Local-network preview of the PUBLIC site only (for trying the studio on a real phone on the same Wi-Fi).
 *   1) start the app bound to this machine only:   npx next start -H 127.0.0.1 -p 3700
 *   2) start this gate:                             node scripts/studio-lan.mjs [port=8370] [target=http://127.0.0.1:3700]
 *   3) on the phone (same network):                http://<this PC's LAN IP>:8370/
 *
 * The gate forwards GET/HEAD for public pages and assets only. The admin panel, sign-in, customer portal, auth
 * callbacks, API routes and server-action POSTs answer 404 — nothing but reading public pages passes. It never
 * forwards to the database: the app talks to its local database itself.
 * NOTE: this does not change what Docker exposes. Stop it (Ctrl+C) and the local stack when you are done.
 */
import http from "node:http";

const [portArg = "8370", target = "http://127.0.0.1:3700"] = process.argv.slice(2);
const T = new URL(target);
// private areas and anything that writes (booking / tracking forms are also left out of the preview)
const BLOCK = /^\/(admin|portal|login|logout|auth|account|api|book|track)(\/|$|\?)/i;
const PUBLIC_POST_OK = false; // public forms (booking, consent) are not needed to try the studio

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";
  if (BLOCK.test(url) || (method !== "GET" && method !== "HEAD" && !PUBLIC_POST_OK) || req.headers["next-action"]) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    return res.end("Not available on the preview link.");
  }
  const headers = { ...req.headers, host: T.host };
  delete headers["next-action"];
  const up = http.request({ hostname: T.hostname, port: T.port, path: url, method, headers }, (r) => {
    const h = { ...r.headers };
    // the preview is plain http on the LAN: drop the https-only header so the phone does not try https
    delete h["strict-transport-security"];
    if (typeof h["content-security-policy"] === "string") h["content-security-policy"] = h["content-security-policy"].replace(/;\s*upgrade-insecure-requests/, "");
    res.writeHead(r.statusCode ?? 502, h);
    r.pipe(res);
  });
  up.on("error", () => {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("App not running on " + target);
  });
  req.pipe(up);
});
server.listen(Number(portArg), "0.0.0.0", () => console.log(`public-only preview on http://0.0.0.0:${portArg} → ${target}`));
