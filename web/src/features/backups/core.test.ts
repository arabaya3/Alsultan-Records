import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { BACKUP_TABLES, runBackupCore, statusFor } from "./core";
import { zip } from "./zip-core";

/**
 * Failure honesty: a backup run must never report `completed` when a table export fails.
 * Uses in-memory fake clients (no network, no writes to any stack). The failing table is
 * injected through the `tables` option, which production never passes anything but
 * BACKUP_TABLES for.
 */
type Row = Record<string, unknown>;

function fakeClients(opts: { known: Set<string>; failUpload?: boolean; failList?: boolean }) {
  const uploads = new Map<string, Buffer>();
  const runs = new Map<string, Row>();
  const admin = {
    from(table: string) {
      const q = {
        select: () => q,
        order: () => q,
        range: async () =>
          opts.known.has(table)
            ? { data: [{ id: `${table}-1` }], error: null }
            : { data: null, error: { message: `relation "public.${table}" does not exist` } },
      };
      return q;
    },
    storage: {
      from: () => ({
        list: async () => (opts.failList ? { data: null, error: { message: "list boom" } } : { data: [], error: null }),
      }),
    },
  };
  const owner = {
    from(table: string) {
      expect(table).toBe("backup_runs");
      return {
        insert: (row: Row) => ({
          select: () => ({
            single: async () => {
              runs.set("run-1", { ...row });
              return { data: { id: "run-1" }, error: null };
            },
          }),
        }),
        update: (patch: Row) => ({
          eq: async (_c: string, id: string) => {
            runs.set(id, { ...runs.get(id), ...patch });
            return { error: null };
          },
        }),
      };
    },
    storage: {
      from: () => ({
        upload: async (p: string, body: Buffer) => {
          if (opts.failUpload) return { error: { message: "upload boom" } };
          uploads.set(p, body);
          return { error: null };
        },
      }),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { owner: owner as any, admin: admin as any, uploads, runs };
}

describe("backup status honesty", () => {
  it("statusFor", () => {
    expect(statusFor(33, 0)).toBe("completed");
    expect(statusFor(32, 1)).toBe("partial");
    expect(statusFor(0, 34)).toBe("failed");
  });

  it("all tables ok -> completed, archives are real zips", async () => {
    const c = fakeClients({ known: new Set(BACKUP_TABLES) });
    const res = await runBackupCore({ owner: c.owner, admin: c.admin, zip });
    if ("error" in res) throw new Error(res.error);
    expect(res.status).toBe("completed");
    expect(Object.keys(res.tableCounts)).toHaveLength(BACKUP_TABLES.length);
    expect(c.runs.get("run-1")?.status).toBe("completed");
    const z = c.uploads.get("run-1/tables/events.zip")!;
    // local header: compressed size at 18, name length at 26
    const nameLen = z.readUInt16LE(26);
    const comp = z.subarray(30 + nameLen, 30 + nameLen + z.readUInt32LE(18));
    expect(JSON.parse(inflateRawSync(comp).toString("utf8")).count).toBe(1);
  });

  it("an unknown table makes the run partial and is recorded in errors", async () => {
    const c = fakeClients({ known: new Set(BACKUP_TABLES) });
    const res = await runBackupCore({ owner: c.owner, admin: c.admin, zip, tables: [...BACKUP_TABLES, "no_such_table_for_test"] });
    if ("error" in res) throw new Error(res.error);
    expect(res.status).toBe("partial");
    const rec = c.runs.get("run-1")!;
    expect(rec.status).toBe("partial");
    expect(rec.errors).toEqual([{ scope: "table:no_such_table_for_test", message: expect.stringContaining("does not exist") }]);
    expect((rec.table_counts as Record<string, number>).no_such_table_for_test).toBeUndefined();
  });

  it("only unknown tables -> failed", async () => {
    const c = fakeClients({ known: new Set() });
    const res = await runBackupCore({ owner: c.owner, admin: c.admin, zip, tables: ["nope_a", "nope_b"] });
    if ("error" in res) throw new Error(res.error);
    expect(res.status).toBe("failed");
    expect(c.runs.get("run-1")?.status).toBe("failed");
  });

  it("a storage-manifest failure alone is not completed", async () => {
    const c = fakeClients({ known: new Set(BACKUP_TABLES), failList: true });
    const res = await runBackupCore({ owner: c.owner, admin: c.admin, zip });
    if ("error" in res) throw new Error(res.error);
    expect(res.status).toBe("partial");
    expect(res.errors.map((e) => e.scope)).toEqual(["storage-manifest"]);
  });

  it("upload failures fail every table", async () => {
    const c = fakeClients({ known: new Set(BACKUP_TABLES), failUpload: true });
    const res = await runBackupCore({ owner: c.owner, admin: c.admin, zip });
    if ("error" in res) throw new Error(res.error);
    expect(res.status).toBe("failed");
  });
});
