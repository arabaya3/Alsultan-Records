"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { guard, ADMIN_ROLES } from "@/features/admin/guard";
import { pick } from "@/features/admin/query";
import { dbMessage, fail, FORBIDDEN, isUuid, ok, str, type ActionResult } from "@/features/admin/result";

/** Moderate one or many reviews; per-item results are reported. */
export async function moderateReviews(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const status = pick(str(fd, "status"), ["approved", "rejected", "pending"] as const);
  const ids = fd.getAll("ids").map(String).filter(isUuid).slice(0, 100);
  if (!status || !ids.length) return fail("اختر تقييماً واحداً على الأقل.");
  const sb = await createClient();
  let okCount = 0;
  let firstError = "";
  for (const id of ids) {
    const { error, count } = await sb.from("reviews").update({ status }, { count: "exact" }).eq("id", id);
    if (!error && count) okCount++;
    else if (!firstError) firstError = dbMessage(error);
  }
  refresh();
  const word = status === "approved" ? "نُشر" : status === "rejected" ? "رُفض" : "أُعيد للمراجعة";
  const msg = `${word} ${okCount} من ${ids.length}.${okCount < ids.length ? ` تعذّر ${ids.length - okCount}: ${firstError}` : ""}`;
  return okCount === ids.length ? ok(msg) : fail(msg);
}
