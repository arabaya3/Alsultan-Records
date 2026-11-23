import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every write that changes what visitors see of a project or its photos expires the public cache — once, AFTER its
 * last successful write, and not at all when nothing changed. The actions run for real here against a scripted
 * database; only the outside world (auth, Supabase, Next's cache) is replaced. `log` records the order of effects.
 */
const log = vi.hoisted(() => [] as string[]);
const guardOk = vi.hoisted(() => ({ value: true }));
const script = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, rpc: [] as unknown[], storage: [] as unknown[] }));
const cleanupResult = vi.hoisted(() => ({ value: { removed: 1, failed: 0 } }));
const retractResult = vi.hoisted(() => ({ value: { rows: 1, message: "" } }));
const customer = vi.hoisted(() => ({ value: true }));

/** A Supabase-like client: each awaited query takes the next scripted answer for its table and logs its write verb. */
function fakeClient() {
  const chain = (table: string) => {
    let verb = "select";
    const p: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => {
              if (verb !== "select") log.push(`${verb}:${table}`);
              resolve(script.tables[table]?.shift() ?? { data: null, error: null });
            };
          }
          return () => {
            if (prop === "insert" || prop === "update" || prop === "delete") verb = prop;
            return p;
          };
        },
      },
    );
    return p;
  };
  const storageBucket = () =>
    new Proxy(
      {},
      {
        get(_t, prop: string) {
          return async () => {
            log.push(`storage:${prop}`);
            return script.storage.shift() ?? { data: null, error: null };
          };
        },
      },
    );
  return {
    from: (t: string) => chain(t),
    rpc: async (name: string) => {
      const r = (script.rpc.shift() as { error: unknown } | undefined) ?? { error: null };
      if (!r.error) log.push(`rpc:${name}`);
      return r;
    },
    storage: { from: storageBucket },
  };
}

vi.mock("next/cache", () => ({ refresh: () => void log.push("refresh"), updateTag: (t: string) => void log.push(`updateTag:${t}`) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => void log.push(`redirect:${to}`) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeClient() }));
vi.mock("@/features/admin/guard", () => ({ guard: async () => guardOk.value, ADMIN_ROLES: ["admin"], ALL_STAFF: ["admin"] }));
vi.mock("@/features/publishing/public-cache", () => ({ expirePublicProjects: () => void log.push("EXPIRE") }));
vi.mock("@/features/publishing/server", () => ({
  PRIVATE_BUCKET: "private-media",
  PUBLIC_BUCKET: "public-media",
  cleanupPublicMedia: async () => {
    log.push("cleanupPublicMedia");
    return cleanupResult.value;
  },
  retractEventPublicCopies: async () => {
    log.push("retract");
    return retractResult.value;
  },
}));
vi.mock("@/features/publishing/cleanup", () => ({ cleanupMessage: () => "", processStorageCleanup: async () => ({ claimed: 0 }) }));
vi.mock("@/features/portal/session", () => ({
  customerForAction: async () => (customer.value ? { supabase: fakeClient() } : null),
  isUuid: (v: string) => /^[0-9a-f-]{36}$/.test(v),
  MSG: { auth: "auth", forbidden: "forbidden", unavailable: "unavailable" },
}));

const EVENT = "00000000-0000-4000-8000-0000000000e2";
const ASSET = "11111111-1111-4111-8111-111111111111";
const PUBLIC = "22222222-2222-4222-8222-222222222222";
const form = (o: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};
const START = { ok: true, message: "" };
const expires = () => log.filter((x) => x === "EXPIRE").length;
const privateAsset = { data: { id: ASSET, event_id: EVENT, kind: "image", variants: { display: `events/${EVENT}/${ASSET}/display.webp`, thumb: `events/${EVENT}/${ASSET}/thumb.webp` }, width: 10, height: 10, sort_order: 0 }, error: null };
const publishedEvent = { data: { is_published: true, publication_consent: "granted" }, error: null };

beforeEach(() => {
  log.length = 0;
  guardOk.value = true;
  customer.value = true;
  script.tables = {};
  script.rpc = [];
  script.storage = [];
  cleanupResult.value = { removed: 1, failed: 0 };
  retractResult.value = { rows: 1, message: "" };
});

describe("one photo: publish / unpublish / delete", () => {
  it("publish: expires after the public row is inserted, exactly once", async () => {
    const { publishMediaItem } = await import("./media-actions");
    script.tables = { media_assets: [privateAsset, { data: null, error: null }, { error: null }], events: [publishedEvent] };
    const r = await publishMediaItem(START, form({ id: ASSET }));
    expect(r.ok).toBe(true);
    expect(expires()).toBe(1);
    expect(log.indexOf("EXPIRE")).toBeGreaterThan(log.indexOf("insert:media_assets"));
    expect(log.indexOf("EXPIRE")).toBeGreaterThan(log.lastIndexOf("storage:copy"));
    // a leftover object of an earlier publication is cleared before the copy (the copy fails on an existing object)
    expect(log.indexOf("storage:remove")).toBeGreaterThanOrEqual(0);
    expect(log.indexOf("storage:remove")).toBeLessThan(log.indexOf("storage:copy"));
  });

  it("publish: nothing is expired when the row could not be inserted, the copy failed, the event is not public, or the caller is not an admin", async () => {
    const { publishMediaItem } = await import("./media-actions");
    script.tables = { media_assets: [privateAsset, { data: null, error: null }, { error: { code: "42501" } }], events: [publishedEvent] };
    expect((await publishMediaItem(START, form({ id: ASSET }))).ok).toBe(false);

    script.tables = { media_assets: [privateAsset, { data: null, error: null }], events: [publishedEvent] };
    script.storage = [{ error: null }, { error: { message: "copy failed" } }]; // leftover removal, then the copy
    expect((await publishMediaItem(START, form({ id: ASSET }))).ok).toBe(false);

    script.tables = { media_assets: [privateAsset], events: [{ data: { is_published: false, publication_consent: "granted" }, error: null }] };
    script.storage = [];
    expect((await publishMediaItem(START, form({ id: ASSET }))).ok).toBe(false);

    guardOk.value = false;
    expect((await publishMediaItem(START, form({ id: ASSET }))).ok).toBe(false);
    expect(expires()).toBe(0);
  });

  it("publish: an already published photo changes nothing and expires nothing", async () => {
    const { publishMediaItem } = await import("./media-actions");
    script.tables = { media_assets: [privateAsset, { data: { id: PUBLIC, visibility: "public" }, error: null }], events: [publishedEvent] };
    expect((await publishMediaItem(START, form({ id: ASSET }))).ok).toBe(true);
    expect(expires()).toBe(0);
  });

  it("unpublish: expires after the public copy is removed; not when nothing could be removed", async () => {
    const { unpublishMediaItem } = await import("./media-actions");
    expect((await unpublishMediaItem(START, form({ public_id: PUBLIC, event_id: EVENT }))).ok).toBe(true);
    expect(log.filter((x) => x === "EXPIRE" || x === "cleanupPublicMedia")).toEqual(["cleanupPublicMedia", "EXPIRE"]);

    log.length = 0;
    cleanupResult.value = { removed: 0, failed: 1 };
    expect((await unpublishMediaItem(START, form({ public_id: PUBLIC, event_id: EVENT }))).ok).toBe(false);
    expect(expires()).toBe(0);
  });

  it("delete: expires once when a deleted file had a published copy, not for private-only files", async () => {
    const { deleteMediaItems } = await import("./media-actions");
    const rows = { data: [{ id: ASSET, path: "p", variants: {} }], error: null };
    script.tables = { media_assets: [rows, { data: [{ id: PUBLIC }], error: null }, { error: null }] };
    await deleteMediaItems(START, form({ ids: [ASSET], event_id: EVENT }));
    expect(expires()).toBe(1);
    expect(log.indexOf("EXPIRE")).toBeGreaterThan(log.indexOf("cleanupPublicMedia"));

    log.length = 0;
    script.tables = { media_assets: [rows, { data: [], error: null }, { error: null }] };
    await deleteMediaItems(START, form({ ids: [ASSET], event_id: EVENT }));
    expect(expires()).toBe(0);
  });
});

describe("project publication and consent", () => {
  it("stopping publication: the public copies are removed first, then the cache is expired", async () => {
    const { setPublication } = await import("./actions");
    expect((await setPublication(START, form({ id: EVENT, publish: "0" }))).ok).toBe(true);
    expect(log.filter((x) => x.startsWith("rpc:") || x === "retract" || x === "EXPIRE")).toEqual(["rpc:set_event_publication", "retract", "EXPIRE"]);
  });

  it("publishing: expires after the RPC; a refused RPC expires nothing", async () => {
    const { setPublication } = await import("./actions");
    expect((await setPublication(START, form({ id: EVENT, publish: "1" }))).ok).toBe(true);
    expect(log.filter((x) => x.startsWith("rpc:") || x === "retract" || x === "EXPIRE")).toEqual(["rpc:set_event_publication", "EXPIRE"]);

    log.length = 0;
    script.rpc = [{ error: { code: "42501" } }];
    expect((await setPublication(START, form({ id: EVENT, publish: "1" }))).ok).toBe(false);
    expect(expires()).toBe(0);
  });

  it("admin consent change: withdrawn → copies removed, then expired; refused → nothing", async () => {
    const { setConsent } = await import("./actions");
    expect((await setConsent(START, form({ id: EVENT, consent: "revoked" }))).ok).toBe(true);
    expect(log.filter((x) => x.startsWith("rpc:") || x === "retract" || x === "EXPIRE")).toEqual(["rpc:set_publication_consent", "retract", "EXPIRE"]);

    log.length = 0;
    script.rpc = [{ error: { code: "42501" } }];
    expect((await setConsent(START, form({ id: EVENT, consent: "granted" }))).ok).toBe(false);
    expect(expires()).toBe(0);
  });

  it("customer consent change (portal): expires after the RPC; not when it fails or the visitor is not the customer", async () => {
    const { customerSetConsent } = await import("@/features/publishing/consent-actions");
    expect((await customerSetConsent(EVENT, "revoked")).ok).toBe(true);
    expect(log.filter((x) => x.startsWith("rpc:") || x === "EXPIRE")).toEqual(["rpc:set_publication_consent", "EXPIRE"]);

    log.length = 0;
    script.rpc = [{ error: { code: "P0002" } }];
    expect((await customerSetConsent(EVENT, "revoked")).ok).toBe(false);
    customer.value = false;
    expect((await customerSetConsent(EVENT, "revoked")).ok).toBe(false);
    expect(expires()).toBe(0);
  });

  it("manual «إزالة النسخ العامة»: expires only when a public copy was actually removed", async () => {
    const { cleanupPublic } = await import("./actions");
    script.tables = { events: [{ data: { is_published: false, publication_consent: "revoked" }, error: null }] };
    await cleanupPublic(START, form({ id: EVENT }));
    expect(log.filter((x) => x === "retract" || x === "EXPIRE")).toEqual(["retract", "EXPIRE"]);

    log.length = 0;
    retractResult.value = { rows: 0, message: "" };
    script.tables = { events: [{ data: { is_published: false, publication_consent: "revoked" }, error: null }] };
    await cleanupPublic(START, form({ id: EVENT }));
    expect(expires()).toBe(0);
  });

  it("event save, trash and restore: expire after the write; a failed write expires nothing", async () => {
    const { updateEvent, trashEvent, restoreEvent } = await import("./actions");
    const fields = { id: EVENT, title: "عنوان", status: "planned" };
    script.tables = { events: [{ error: null }] };
    const saved = await updateEvent(START, form(fields));
    expect(saved.ok, saved.message).toBe(true);
    expect(log.indexOf("EXPIRE")).toBeGreaterThan(log.indexOf("update:events"));

    log.length = 0;
    script.tables = { events: [{ error: { code: "23505" } }] };
    expect((await updateEvent(START, form(fields))).ok).toBe(false);
    expect(expires()).toBe(0);

    expect((await trashEvent(START, form({ id: EVENT }))).ok).toBe(true);
    expect((await restoreEvent(START, form({ id: EVENT }))).ok).toBe(true);
    expect(log.filter((x) => x.startsWith("rpc:") || x === "EXPIRE")).toEqual(["rpc:trash_event", "EXPIRE", "rpc:restore_event", "EXPIRE"]);

    log.length = 0;
    script.rpc = [{ error: { code: "P0002" } }, { error: { code: "P0002" } }];
    expect((await trashEvent(START, form({ id: EVENT }))).ok).toBe(false);
    expect((await restoreEvent(START, form({ id: EVENT }))).ok).toBe(false);
    expect(expires()).toBe(0);
  });
});
