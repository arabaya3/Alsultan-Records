/**
 * Backup core, free of Next/server-only imports so it can be unit-tested and driven by
 * operator scripts (`node --experimental-strip-types`). The server action in actions.ts is
 * the only production caller; it performs the owner check BEFORE calling runBackupCore.
 *
 * Type-only imports keep this file loadable with Node type stripping.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Every public table, in a restore-friendly order (parents first). */
export const BACKUP_TABLES = [
  "business_settings", "app_settings", "service_categories", "profiles", "customers", "staff_members",
  "media_assets", "services", "booking_requests", "booking_stage_history", "events", "deliverables",
  "deliverable_revisions", "video_comments", "album_selections", "album_selection_items",
  "album_selection_snapshots", "quotes", "quote_items", "contracts", "contract_versions", "payments",
  "expenses", "event_staff_assignments", "equipment", "equipment_assignments", "equipment_maintenance",
  "support_requests", "support_messages", "reviews", "notifications", "audit_events", "backup_runs",
] as const;
export const BACKUP_BUCKETS = ["public-media", "private-media"] as const;
export const BACKUP_BUCKET = "backups"; // owner-only bucket (migration 0008)
const PAGE = 1000;

// Loosely typed on purpose: the core is shared with plain-JS operator scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;
type ZipFn = (entries: { name: string; data: Buffer }[]) => Buffer;

export type BackupStatus = "completed" | "partial" | "failed";
export type BackupResult = {
  runId: string;
  status: BackupStatus;
  tableCounts: Record<string, number>;
  objectCounts: Record<string, number>;
  errors: { scope: string; message: string }[];
  location: string;
  tablesTotal: number;
};

async function exportTable(admin: Client, table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select("*").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export type ObjectEntry = { bucket: string; path: string; size: number | null; mimetype: string | null; updated_at: string | null };

export async function listBucket(admin: Client, bucket: string, prefix = "", out: ObjectEntry[] = []): Promise<ObjectEntry[]> {
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(error.message);
    for (const item of data ?? []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        await listBucket(admin, bucket, path, out);
      } else {
        const meta = (item.metadata ?? {}) as { size?: number; mimetype?: string };
        out.push({ bucket, path, size: meta.size ?? null, mimetype: meta.mimetype ?? null, updated_at: item.updated_at ?? null });
      }
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export function statusFor(succeededTables: number, errorCount: number): BackupStatus {
  return errorCount === 0 ? "completed" : succeededTables > 0 ? "partial" : "failed";
}

/**
 * Exports every table (service-role reads, see actions.ts) and the storage manifest, writes the
 * archives with the OWNER's client, and records the run through the owner's client.
 * Status: completed only if every table and the manifest succeeded; partial if at least one
 * table succeeded; failed otherwise. `tables` exists so tests can inject a failing table name;
 * production always uses BACKUP_TABLES.
 */
export async function runBackupCore(opts: {
  owner: Client;
  admin: Client;
  zip: ZipFn;
  tables?: readonly string[];
  /** Album objects moved to S3 (the caller holds the keys): listed too, or the manifest would silently miss them. */
  s3Objects?: AsyncIterable<{ path: string; size: number | null; updated_at: string | null }>;
}): Promise<BackupResult | { error: string }> {
  const { owner: sb, admin, zip } = opts;
  const tables = opts.tables ?? BACKUP_TABLES;
  const { data: run, error: runErr } = await sb.from("backup_runs").insert({ kind: "manual-json", status: "running" }).select("id").single();
  if (runErr || !run) return { error: runErr?.message ?? "no run row" };
  const runId = (run as { id: string }).id;
  const location = `${BACKUP_BUCKET}/${runId}/`;
  const tableCounts: Record<string, number> = {};
  const objectCounts: Record<string, number> = {};
  const errors: { scope: string; message: string }[] = [];

  for (const table of tables) {
    try {
      const rows = await exportTable(admin, table);
      const json = Buffer.from(JSON.stringify({ table, exported_at: new Date().toISOString(), count: rows.length, rows }), "utf8");
      const up = await sb.storage.from(BACKUP_BUCKET).upload(`${runId}/tables/${table}.zip`, zip([{ name: `${table}.json`, data: json }]), {
        contentType: "application/zip",
        upsert: false,
      });
      if (up.error) throw new Error(`upload: ${up.error.message}`);
      tableCounts[table] = rows.length;
    } catch (e) {
      errors.push({ scope: `table:${table}`, message: e instanceof Error ? e.message : String(e) });
    }
  }

  try {
    const manifest: ObjectEntry[] = [];
    for (const b of BACKUP_BUCKETS) {
      const before = manifest.length;
      await listBucket(admin, b, "", manifest);
      objectCounts[b] = manifest.length - before;
    }
    if (opts.s3Objects) {
      let n = 0;
      for await (const o of opts.s3Objects) {
        manifest.push({ bucket: "s3:album-media", path: o.path, size: o.size, mimetype: null, updated_at: o.updated_at });
        n++;
      }
      objectCounts["s3:album-media"] = n;
    }
    const data = Buffer.from(JSON.stringify({ generated_at: new Date().toISOString(), note: "Binary objects are NOT included; this lists what must be copied separately.", objects: manifest }), "utf8");
    const up = await sb.storage.from(BACKUP_BUCKET).upload(`${runId}/storage-manifest.zip`, zip([{ name: "storage-manifest.json", data }]), {
      contentType: "application/zip",
      upsert: false,
    });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
  } catch (e) {
    errors.push({ scope: "storage-manifest", message: e instanceof Error ? e.message : String(e) });
  }

  const succeeded = Object.keys(tableCounts).length;
  const status = statusFor(succeeded, errors.length);
  const fin = await sb
    .from("backup_runs")
    .update({ status, table_counts: tableCounts, object_counts: objectCounts, errors: errors.length ? errors : null, location, finished_at: new Date().toISOString() })
    .eq("id", runId);
  if (fin.error) errors.push({ scope: "run-record", message: fin.error.message });
  return { runId, status, tableCounts, objectCounts, errors, location, tablesTotal: tables.length };
}
