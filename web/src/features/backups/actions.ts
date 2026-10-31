"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, OWNER_ONLY } from "@/features/admin/guard";
import { fail, FORBIDDEN, ok, type ActionResult } from "@/features/admin/result";
import { BACKUP_TABLES, runBackupCore } from "./core";
import { zip } from "./zip";
import { s3Env, s3List } from "@/lib/album-storage/s3";

/**
 * Owner-only full export. Documented use of the secret-key client:
 *  - RLS hides some columns/rows even from the owner (customers.notes, events internal notes,
 *    other users' notifications), so a complete export needs service-role READS, and the
 *    storage manifest lists every object in both media buckets.
 *  - Files are WRITTEN with the owner's own client to the owner-only "backups" bucket.
 *  - The run itself is recorded through the OWNER's client (backup_runs RLS = owner), so
 *    every run is attributable; the action re-checks the owner role first.
 * Status: completed only if every table and the storage manifest succeeded (see core.ts).
 */
export async function runBackup(): Promise<ActionResult> {
  const session = await guard(OWNER_ONLY);
  if (!session) return FORBIDDEN;
  const sb = await createClient();
  const res = await runBackupCore({ owner: sb, admin: createAdminClient(), zip, tables: BACKUP_TABLES, s3Objects: s3Env() ? s3List() : undefined });
  if ("error" in res) return fail("تعذّر بدء النسخة الاحتياطية.");
  refresh();
  const succeeded = Object.keys(res.tableCounts).length;
  if (res.status === "completed" && res.errors.length === 0) return ok(`اكتملت النسخة: ${succeeded} جدولاً وقائمة الملفات.`);
  return fail(`النسخة ${res.status === "failed" ? "فاشلة" : "جزئية"}: نجح ${succeeded} من ${res.tablesTotal} جدولاً. التفاصيل في السجل.`);
}
