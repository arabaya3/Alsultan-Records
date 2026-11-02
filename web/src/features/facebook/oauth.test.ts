import { describe, expect, it } from "vitest";
import { authorizeUrl, metaEnv, pageFromCode, PERMISSIONS, type MetaEnv } from "./oauth";

const M: MetaEnv = { appId: "app", appSecret: "secret", pageId: null };
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const page = (id: string, tasks = ["CREATE_CONTENT"]) => ({ id, name: `p${id}`, access_token: `token-${id}`, tasks });

function meta(data: unknown[], fail?: "token") {
  return async (url: string) => {
    if (url.includes("oauth/access_token")) return fail === "token" ? new Response("{}", { status: 400 }) : ok({ access_token: "user-token" });
    return ok({ data });
  };
}

describe("Facebook connect", () => {
  it("stays off without both app keys", () => {
    expect(metaEnv({})).toBeNull();
    expect(metaEnv({ META_APP_ID: "a" })).toBeNull();
    expect(metaEnv({ META_APP_ID: "a", META_APP_SECRET: "s" })).toEqual({ appId: "a", appSecret: "s", pageId: null });
  });
  it("the login link carries state and the permissions, never the secret", () => {
    const u = authorizeUrl(M, "https://x/cb", "st");
    expect(u).toContain("state=st");
    expect(decodeURIComponent(u)).toContain(PERMISSIONS.join(","));
    expect(u).not.toContain("secret");
  });
  it("one page with posting rights is used", async () => {
    expect(await pageFromCode(meta([page("1")]), M, "r", "c")).toEqual({ ok: true, id: "1", name: "p1", token: "token-1" });
  });
  it("several pages need META_PAGE_ID, and that exact page is used", async () => {
    expect(await pageFromCode(meta([page("1"), page("2")]), M, "r", "c")).toEqual({ ok: false, reason: "many_pages" });
    expect(await pageFromCode(meta([page("1"), page("2")]), { ...M, pageId: "2" }, "r", "c")).toMatchObject({ ok: true, id: "2" });
    expect(await pageFromCode(meta([page("1")]), { ...M, pageId: "9" }, "r", "c")).toEqual({ ok: false, reason: "no_page" });
  });
  it("no posting rights, no page, or a Meta error never connect", async () => {
    expect(await pageFromCode(meta([page("1", ["ANALYZE"])]), M, "r", "c")).toEqual({ ok: false, reason: "no_permission" });
    expect(await pageFromCode(meta([]), M, "r", "c")).toEqual({ ok: false, reason: "no_page" });
    expect(await pageFromCode(meta([], "token"), M, "r", "c")).toEqual({ ok: false, reason: "meta_error" });
  });
});
