/**
 * One JSON line per server error (instrumentation.ts → onRequestError → console.error), searchable in the Vercel runtime
 * logs by digest, route or name. Built to be safe to keep: no headers or cookies, no query string (auth codes, token
 * hashes, signed-URL tokens live there), and tokens, keys and e-mail addresses in the message are redacted. Pure: no
 * Next or server-only imports, unit-tested in server-error.test.ts.
 */
export type ServerErrorRecord = {
  level: "error";
  source: "next";
  at: string;
  digest: string | null;
  name: string;
  message: string;
  method: string;
  path: string;
  routePath: string;
  routeType: string;
};

const MAX_MESSAGE = 500;

export function redact(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+/g, "[jwt]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g, "[secret]")
    .replace(/(Bearer\s+)\S+/gi, "$1[redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/(https?:\/\/[^\s?"']+)\?[^\s"']*/g, "$1?[query]");
}

export function serverErrorRecord(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routePath: string; routeType: string },
): ServerErrorRecord {
  const e = err instanceof Error ? err : null;
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : null;
  return {
    level: "error",
    source: "next",
    at: new Date().toISOString(),
    digest,
    name: e?.name ?? "NonError",
    message: redact(e ? e.message : String(err)).slice(0, MAX_MESSAGE),
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
  };
}
