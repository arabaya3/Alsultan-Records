import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEYS = ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NODE_ENV"] as const;
let saved: Record<string, string | undefined>;

async function load(env: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete (process.env as Record<string, string | undefined>)[k];
  Object.assign(process.env, env);
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return import("./turnstile-policy");
}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  Object.assign(process.env, saved);
  vi.restoreAllMocks();
});

const CLOUD = "https://dyuixzxmmeiypvawzmty.supabase.co";
const LOCAL = "http://127.0.0.1:54321";

describe("turnstile policy", () => {
  it("production + cloud + no keys → unavailable and refuses", async () => {
    const m = await load({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: CLOUD });
    expect(m.turnstileMode()).toBe("unavailable");
    expect(await m.verifyTurnstile("anything", "1.2.3.4")).toBe(false);
  });
  it("production + cloud + only one key → unavailable (no partial config)", async () => {
    const a = await load({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: CLOUD, TURNSTILE_SECRET_KEY: "s" });
    expect(a.turnstileMode()).toBe("unavailable");
    const b = await load({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: CLOUD, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "k" });
    expect(b.turnstileMode()).toBe("unavailable");
  });
  it("production + local stack + no keys → explicit local bypass (logged)", async () => {
    const m = await load({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: LOCAL });
    expect(m.turnstileMode()).toBe("bypass-local-stack");
    expect(await m.verifyTurnstile(null, "unknown")).toBe(true);
    expect(console.warn).toHaveBeenCalledOnce();
  });
  it("dev + no keys → dev bypass", async () => {
    const m = await load({ NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: CLOUD });
    expect(m.turnstileMode()).toBe("bypass-dev");
  });
  it("both keys → enforce; missing token refused; siteverify result honoured", async () => {
    const m = await load({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: CLOUD, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "k", TURNSTILE_SECRET_KEY: "s" });
    expect(m.turnstileMode()).toBe("enforce");
    expect(await m.verifyTurnstile(null, "1.2.3.4")).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false }))));
    expect(await m.verifyTurnstile("tok", "1.2.3.4")).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }))));
    expect(await m.verifyTurnstile("tok", "1.2.3.4")).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await m.verifyTurnstile("tok", "1.2.3.4")).toBe(false);
    vi.unstubAllGlobals();
  });
  it("enforce mode works even with local stack (keys always win)", async () => {
    const m = await load({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: LOCAL, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "k", TURNSTILE_SECRET_KEY: "s" });
    expect(m.turnstileMode()).toBe("enforce");
  });
});
