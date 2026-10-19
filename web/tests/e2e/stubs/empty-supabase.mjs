// Test-only stub: a "Supabase" that has nothing published. Every PostgREST read returns [].
// Usage: node tests/e2e/stubs/empty-supabase.mjs   (listens on 127.0.0.1:3701)
// Build/start the app with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3701 to render empty states.
import http from "node:http";

const port = Number(process.env.STUB_PORT ?? 3701);
http
  .createServer((req, res) => {
    if (req.url?.startsWith("/rest/v1/")) {
      res.writeHead(200, { "content-type": "application/json", "content-range": "*/0" });
      res.end("[]");
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"message":"not found"}');
  })
  .listen(port, "127.0.0.1", () => console.log(`empty supabase stub on ${port}`));
