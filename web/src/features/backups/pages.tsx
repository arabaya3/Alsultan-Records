import { createClient } from "@/lib/supabase/server";
import { Forbidden, guard, OWNER_ONLY } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, LoadError, PageHeader } from "@/features/admin/ui";
import { fmtDateTime } from "@/features/admin/format";
import { BACKUP_STATUS } from "@/features/admin/labels";
import { runBackup } from "./actions";

export async function BackupsPage() {
  if (!(await guard(OWNER_ONLY))) return <Forbidden />;
  const sb = await createClient();
  const { data, error } = await sb
    .from("backup_runs")
    .select("id, kind, status, table_counts, object_counts, errors, location, started_at, finished_at")
    .order("started_at", { ascending: false })
    .limit(30);
  return (
    <>
      <PageHeader title="النسخ الاحتياطي" lead="نسخة من كل الجداول + قائمة بملفات التخزين. الملفات نفسها (الصور والفيديو) تُنسخ بشكل منفصل — راجع دليل الاسترجاع." />
      <Card title="نسخة جديدة" className="mb-4">
        <ActionForm action={runBackup} submitLabel="بدء النسخ الآن" kind="primary" testId="backup-form">
          <p className="text-sm text-on-cream-muted">قد تستغرق دقيقة. تُحفظ في مكان خاص لا يصل إليه العامة.</p>
        </ActionForm>
      </Card>
      {error ? <LoadError /> : (
        <ul className="space-y-3" data-testid="backup-runs">
          {data?.map((r) => {
            const tables = (r.table_counts ?? {}) as Record<string, number>;
            const objects = (r.object_counts ?? {}) as Record<string, number>;
            const errs = (Array.isArray(r.errors) ? r.errors : []) as { scope?: string; message?: string }[];
            const rows = Object.values(tables).reduce((a, b) => a + b, 0);
            return (
              <li key={r.id} className="rounded-md border border-cream-line bg-[#fffdf8] p-4 text-sm" data-testid="backup-run" data-status={r.status}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{fmtDateTime(r.started_at)}</span>
                  <Badge tone={r.status === "completed" ? "success" : r.status === "running" ? "gold" : "danger"}>{BACKUP_STATUS[r.status]}</Badge>
                </div>
                <p className="mt-1 text-on-cream-muted">
                  {Object.keys(tables).length} جدولاً · {rows} سجل · ملفات: {Object.entries(objects).map(([b, n]) => `${b} ${n}`).join("، ") || "—"}
                </p>
                <p className="mt-1 text-xs text-on-cream-muted" dir="ltr">{r.location ?? ""}</p>
                {errs.length ? (
                  <ul className="mt-2 list-disc ps-5 text-xs text-danger">
                    {errs.map((e, i) => <li key={i} dir="ltr">{e.scope}: {e.message}</li>)}
                  </ul>
                ) : null}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs">عدد السجلات لكل جدول</summary>
                  <ul className="mt-1 grid grid-cols-2 gap-x-4 text-xs sm:grid-cols-3" dir="ltr">
                    {Object.entries(tables).map(([t, n]) => <li key={t}>{t}: {n}</li>)}
                  </ul>
                </details>
              </li>
            );
          })}
          {!data?.length ? <li className="text-sm text-on-cream-muted">لا توجد نسخ بعد.</li> : null}
        </ul>
      )}
    </>
  );
}
