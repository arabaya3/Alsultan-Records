"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, OWNER_ONLY } from "@/features/admin/guard";
import { fail, FORBIDDEN, ok, type ActionResult } from "@/features/admin/result";
import type { Database } from "@/types/database";
import { zip } from "./zip";

type TableName = keyof Database["public"]["Tables"];

/** Every public table, in a restore-friendly order (parents first). */
const BACKUP_TABLES: TableName[] = [
  "business_settings", "app_settings", "service_categories", "profiles", "customers", "staff_members",
  "media_assets", "services", "booking_requests", "booking_stage_history", "events", "deliverables",
  "deliverable_revisions", "video_comments", "album_selections", "album_selection_items",
  "album_selection_snapshots", "quotes", "quote_items", "contracts", "contract_versions", "payments",
  "expenses", "event_staff_assignments", "equipment", "equipment_assignments", "equipment_maintenance",
  "support_requests", "support_messages", "reviews", "notifications", "audit_events", "backup_runs",
];
const BUCKETS = ["public-media", "private-media"] as const;
const PAGE = 1000;
const BACKUP_BUCKET = "private-media";

type AdminClient = ReturnType<typeof createAdminClient>;

async function exportTable(admin: AdminClient, table: TableName): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select("*").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

type ObjectEntry = { bucket: string; path: string; size: number | null; mimetype: string | null; updated_at: string | null };

async function listBucket(admin: AdminClient, bucket: string, prefix = "", out: ObjectEntry[] = []): Promise<ObjectEntry[]> {
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(error.message);
    for (const item of data ?? []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        if (bucket === BACKUP_BUCKET && path === "backups") continue; // do not back up backups
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

/**
 * Owner-only full export. Documented use of the secret-key client:
 *  - RLS hides some columns/rows even from the owner (customers.notes, events internal notes,
 *    other users' notifications) and storage policies forbid writing outside events/…,
 *    so a complete backup needs service-role reads + the backups/ prefix write.
 *  - The run itself is recorded through the OWNER's client (backup_runs RLS = owner), so
 *    every run is attributable; the action re-checks the owner role first.
 * Status: completed only if every table and the storage manifest succeeded.
 */
export async function runBackup(): Promise<ActionResult> {
  const session = await guard(OWNER_ONLY);
  if (!session) return FORBIDDEN;
  const sb = await createClient();
  const { data: run, error: runErr } = await sb.from("backup_runs").insert({ kind: "manual-json", status: "running" }).select("id").single();
  if (runErr || !run) return fail("تعذّر بدء النسخة الاحتياطية.");
  const location = `${BACKUP_BUCKET}/backups/${run.id}/`;
  const admin = createAdminClient();
  const tableCounts: Record<string, number> = {};
  const objectCounts: Record<string, number> = {};
  const errors: { scope: string; message: string }[] = [];

  for (const table of BACKUP_TABLES) {
    try {
      const rows = await exportTable(admin, table);
      const json = Buffer.from(JSON.stringify({ table, exported_at: new Date().toISOString(), count: rows.length, rows }), "utf8");
      const up = await admin.storage.from(BACKUP_BUCKET).upload(`backups/${run.id}/tables/${table}.zip`, zip([{ name: `${table}.json`, data: json }]), {
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
    for (const b of BUCKETS) {
      const before = manifest.length;
      await listBucket(admin, b, "", manifest);
      objectCounts[b] = manifest.length - before;
    }
    const data = Buffer.from(JSON.stringify({ generated_at: new Date().toISOString(), note: "Binary objects are NOT included; this lists what must be copied separately.", objects: manifest }), "utf8");
    const up = await admin.storage.from(BACKUP_BUCKET).upload(`backups/${run.id}/storage-manifest.zip`, zip([{ name: "storage-manifest.json", data }]), {
      contentType: "application/zip",
      upsert: false,
    });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
  } catch (e) {
    errors.push({ scope: "storage-manifest", message: e instanceof Error ? e.message : String(e) });
  }

  const succeeded = Object.keys(tableCounts).length;
  const status = errors.length === 0 ? "completed" : succeeded > 0 ? "partial" : "failed";
  await sb
    .from("backup_runs")
    .update({ status, table_counts: tableCounts, object_counts: objectCounts, errors: errors.length ? errors : null, location, finished_at: new Date().toISOString() })
    .eq("id", run.id);
  refresh();
  if (status === "completed") return ok(`اكتملت النسخة: ${succeeded} جدولاً وقائمة الملفات.`);
  return fail(`النسخة ${status === "partial" ? "جزئية" : "فاشلة"}: نجح ${succeeded} من ${BACKUP_TABLES.length} جدولاً. التفاصيل في السجل.`);
}
