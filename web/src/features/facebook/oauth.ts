import { GRAPH_VERSION, type Fetch } from "./graph";

/**
 * Facebook Login for the Page link. Pure apart from the injected fetch; the tokens stay on the server and go only into
 * Vault through public.meta_connect. Off until META_APP_ID and META_APP_SECRET are set.
 */
export const PERMISSIONS = ["pages_show_list", "pages_read_engagement", "pages_manage_posts"];

export type MetaEnv = { appId: string; appSecret: string; pageId: string | null };

export function metaEnv(env: Record<string, string | undefined> = process.env): MetaEnv | null {
  if (!env.META_APP_ID || !env.META_APP_SECRET) return null;
  return { appId: env.META_APP_ID, appSecret: env.META_APP_SECRET, pageId: env.META_PAGE_ID || null };
}

export function authorizeUrl(m: MetaEnv, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: m.appId, redirect_uri: redirectUri, state, response_type: "code", scope: PERMISSIONS.join(",") });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${q}`;
}

export type PageChoice = { ok: true; id: string; name: string; token: string } | { ok: false; reason: "no_page" | "many_pages" | "no_permission" | "meta_error" };

type Account = { id: string; name: string; access_token?: string; tasks?: string[] };

const graph = (path: string, q: Record<string, string>) => `https://graph.facebook.com/${GRAPH_VERSION}/${path}?${new URLSearchParams(q)}`;

async function json(f: Fetch, url: string): Promise<Record<string, unknown> | null> {
  const r = await f(url, { method: "GET", cache: "no-store" });
  return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
}

/** Code → long-lived user token → the Page's token. A Page is used only if this person may post on it. */
export async function pageFromCode(f: Fetch, m: MetaEnv, redirectUri: string, code: string): Promise<PageChoice> {
  const short = await json(f, graph("oauth/access_token", { client_id: m.appId, client_secret: m.appSecret, redirect_uri: redirectUri, code }));
  if (typeof short?.access_token !== "string") return { ok: false, reason: "meta_error" };
  const long = await json(f, graph("oauth/access_token", { grant_type: "fb_exchange_token", client_id: m.appId, client_secret: m.appSecret, fb_exchange_token: short.access_token }));
  if (typeof long?.access_token !== "string") return { ok: false, reason: "meta_error" };
  const accounts = await json(f, graph("me/accounts", { fields: "id,name,access_token,tasks", limit: "100", access_token: long.access_token }));
  if (!Array.isArray(accounts?.data)) return { ok: false, reason: "meta_error" };
  const pages = accounts.data as Account[];
  const page = m.pageId ? pages.find((p) => p.id === m.pageId) : pages.length === 1 ? pages[0] : undefined;
  if (!page) return { ok: false, reason: pages.length && !m.pageId ? "many_pages" : "no_page" };
  if (!page.access_token || !page.tasks?.includes("CREATE_CONTENT")) return { ok: false, reason: "no_permission" };
  return { ok: true, id: page.id, name: page.name, token: page.access_token };
}

export const FAILURE_TEXT: Record<string, string> = {
  denied: "لم يكتمل الربط: أُلغي تسجيل الدخول في فيسبوك.",
  state: "انتهت صلاحية طلب الربط. أعد المحاولة.",
  no_page: "لم نجد الصفحة المطلوبة في هذا الحساب.",
  many_pages: "حسابك يدير أكثر من صفحة. اضبط META_PAGE_ID على Vercel ثم أعد الربط.",
  no_permission: "حسابك لا يملك صلاحية النشر على هذه الصفحة.",
  meta_error: "تعذّر الاتصال بفيسبوك. أعد المحاولة.",
  save: "تعذّر حفظ الربط. أعد المحاولة.",
};
