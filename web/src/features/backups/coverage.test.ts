import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BACKUP_BUCKETS, BACKUP_TABLES } from "./core";

/**
 * Every table the migrations create in `public` must be in both backups: the owner's in-app run (core.ts) and the
 * operator export (scripts/backup-export.mjs). A new table that is not added to them fails here, instead of being
 * silently left out of a run that still reports «اكتملت».
 */
function schemaTables(): string[] {
  const dir = "supabase/migrations";
  const created = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(`${dir}/${f}`, "utf8");
    // In file order: a migration may drop and re-create a table.
    for (const m of sql.matchAll(/(create|drop) table (?:if (?:not )?exists )?public\.([a-z_]+)/gi)) {
      if (m[1].toLowerCase() === "create") created.add(m[2].toLowerCase());
      else created.delete(m[2].toLowerCase());
    }
  }
  return [...created].sort();
}

function scriptTables(): string[] {
  const src = readFileSync("scripts/backup-export.mjs", "utf8");
  const block = /export const EXPORT_TABLES = \[([\s\S]*?)\];/.exec(src)?.[1] ?? "";
  return [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("backup coverage", () => {
  const tables = schemaTables();

  it("finds the schema's tables", () => expect(tables.length).toBeGreaterThan(50));

  it("the in-app backup exports every public table", () => {
    expect(tables.filter((t) => !(BACKUP_TABLES as readonly string[]).includes(t))).toEqual([]);
  });

  it("the operator export (backup-export.mjs) exports every public table", () => {
    const listed = scriptTables();
    expect(tables.filter((t) => !listed.includes(t))).toEqual([]);
  });

  it("lists no table twice and none that does not exist", () => {
    expect(new Set(BACKUP_TABLES).size).toBe(BACKUP_TABLES.length);
    expect((BACKUP_TABLES as readonly string[]).filter((t) => !tables.includes(t))).toEqual([]);
    expect(scriptTables().filter((t) => !tables.includes(t))).toEqual([]);
  });

  it("the in-app manifest lists every storage bucket the app writes to", () => {
    for (const b of ["public-media", "private-media", "album-media", "site-media", "reel-media"]) expect(BACKUP_BUCKETS as readonly string[]).toContain(b);
  });
});
