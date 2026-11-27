import { describe, expect, it } from "vitest";
import { redact, serverErrorRecord } from "./server-error";

const ctx = { routerKind: "App Router", routePath: "/portal/events/[eventId]/gallery", routeType: "render" } as const;

describe("server error log record", () => {
  it("keeps what is needed to find the failure: digest, error name, short message, route, method, path without query", () => {
    const err = Object.assign(new Error("storage upstream 503"), { digest: "123456789" });
    const r = serverErrorRecord(err, { path: "/portal/events/abc/gallery?code=SECRETCODE&next=/x", method: "GET", headers: { cookie: "sb-access-token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc" } }, ctx);
    expect(r).toMatchObject({ level: "error", source: "next", digest: "123456789", name: "Error", message: "storage upstream 503", method: "GET", path: "/portal/events/abc/gallery", routePath: ctx.routePath, routeType: "render" });
    expect(typeof r.at).toBe("string");
  });

  it("never carries headers, cookies or the query string", () => {
    const text = JSON.stringify(serverErrorRecord(new Error("x"), { path: "/auth/callback?code=abc123&token_hash=zzz", method: "GET", headers: { cookie: "sb=1", authorization: "Bearer t" } }, ctx));
    expect(text).not.toMatch(/cookie|authorization|abc123|token_hash|zzz|Bearer/i);
  });

  it("redacts tokens, keys and e-mail addresses that an error message may contain", () => {
    expect(redact("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig-part here")).toBe("jwt [jwt] here");
    expect(redact("key sb_secret_ABCDEFGHIJKLMNOPQRST rest")).toBe("key [secret] rest");
    expect(redact("Authorization: Bearer abc.def.ghi")).toBe("Authorization: Bearer [redacted]");
    expect(redact("user owner@example.com failed")).toBe("user [email] failed");
    expect(redact("https://x.supabase.co/storage/v1/object/sign/a/b.jpg?token=abc")).toBe("https://x.supabase.co/storage/v1/object/sign/a/b.jpg?[query]");
  });

  it("truncates long messages and copes with non-Error values", () => {
    expect(serverErrorRecord(new Error("a".repeat(2000)), { path: "/", method: "GET", headers: {} }, ctx).message.length).toBeLessThanOrEqual(500);
    const r = serverErrorRecord("plain string", { path: "/", method: "POST", headers: {} }, { ...ctx, routeType: "action" });
    expect(r).toMatchObject({ name: "NonError", message: "plain string", routeType: "action" });
  });
});
