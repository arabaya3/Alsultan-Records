import type { Instrumentation } from "next";
import { serverErrorRecord } from "@/lib/observability/server-error";

/**
 * Server error tracking without a third-party service: every error Next captures (render, route handler, server action,
 * proxy) becomes one redacted JSON line in the runtime logs (Vercel → Logs; filter on `"source":"next"` or the digest a
 * visitor's error page shows). No headers, cookies or query strings are logged (lib/observability/server-error.ts).
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  console.error(JSON.stringify(serverErrorRecord(err, request, context)));
};
