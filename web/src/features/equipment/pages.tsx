import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, Field, FilterChips, inputCls, LoadError, PageHeader, Pagination } from "@/features/admin/ui";
import { one, pageOf, pick, rangeOf, type SP } from "@/features/admin/query";
import { fmtDate, fmtDateTime } from "@/features/admin/format";
import { formatMinor } from "@/features/admin/money";
import { EQUIPMENT_STATUS } from "@/features/admin/labels";
import { Constants } from "@/types/database";
import { addMaintenance, finishMaintenance, saveEquipment } from "./actions";

const SIZE = 20;

export async function EquipmentPage({ searchParams }: { searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sp = await searchParams;
  const status = pick(one(sp.status), Constants.public.Enums.equipment_status);
  const page = pageOf(sp.page);
  const sb = await createClient();
  let q = sb
    .from("equipment")
    .select("id, name, serial, status, equipment_maintenance(id, description, started_at, finished_at, cost), equipment_assignments(id, out_at, returned_at, events(title))", { count: "exact" })
    .order("name");
  if (status) q = q.eq("status", status);
  const { data, count, error } = await q.range(...rangeOf(page, SIZE));
  const params = { status: status ?? "" };
  return (
    <>
      <PageHeader title="المعدات والصيانة" lead="تسليم المعدات للمناسبات يتم من صفحة المناسبة، والنظام يمنع تداخل الفترات." />
      <FilterChips base="/admin/equipment" param="status" current={status ?? ""} params={params} options={Constants.public.Enums.equipment_status.map((s) => ({ value: s, label: EQUIPMENT_STATUS[s] }))} />
      {error ? <LoadError /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data?.map((e) => {
            const openMaint = e.equipment_maintenance.filter((m) => !m.finished_at);
            const lastOut = [...e.equipment_assignments].sort((a, b) => b.out_at.localeCompare(a.out_at))[0];
            return (
              <Card key={e.id} title={e.name} actions={<Badge tone={e.status === "maintenance" ? "gold" : e.status === "retired" ? "danger" : "neutral"}>{EQUIPMENT_STATUS[e.status]}</Badge>}>
                <ActionForm action={saveEquipment} submitLabel="حفظ">
                  <input type="hidden" name="id" value={e.id} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="الاسم"><input name="name" required maxLength={200} defaultValue={e.name} className={inputCls} /></Field>
                    <Field label="الرقم التسلسلي"><input name="serial" dir="ltr" maxLength={120} defaultValue={e.serial ?? ""} className={inputCls} /></Field>
                    <Field label="الحالة">
                      <select name="status" defaultValue={e.status} className={inputCls}>
                        {Constants.public.Enums.equipment_status.map((s) => <option key={s} value={s}>{EQUIPMENT_STATUS[s]}</option>)}
                      </select>
                    </Field>
                  </div>
                </ActionForm>
                {lastOut ? (
                  <p className="mt-3 text-xs text-on-cream-muted">
                    آخر تسليم: {lastOut.events?.title ?? "—"} · {fmtDateTime(lastOut.out_at)} {lastOut.returned_at ? "· أُرجعت" : "· لم تُرجع"}
                  </p>
                ) : null}
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm">الصيانة ({e.equipment_maintenance.length}{openMaint.length ? `، مفتوحة ${openMaint.length}` : ""})</summary>
                  <ul className="my-2 space-y-1 text-sm">
                    {e.equipment_maintenance.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>{m.description} <span className="text-xs text-on-cream-muted">· {fmtDate(m.started_at)}{m.cost ? ` · ${formatMinor(m.cost)}` : ""}</span></span>
                        {!m.finished_at ? (
                          <ActionForm action={finishMaintenance} submitLabel="انتهت" kind="ghost" inline>
                            <input type="hidden" name="id" value={m.id} />
                          </ActionForm>
                        ) : <span className="text-xs text-on-cream-muted">انتهت {fmtDate(m.finished_at)}</span>}
                      </li>
                    ))}
                  </ul>
                  <ActionForm action={addMaintenance} submitLabel="تسجيل صيانة" kind="ghost" resetOnSuccess>
                    <input type="hidden" name="equipment_id" value={e.id} />
                    <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
                      <input name="description" required maxLength={1000} aria-label="الوصف" placeholder="الوصف" className={inputCls} />
                      <input name="cost" inputMode="decimal" dir="ltr" aria-label="التكلفة" placeholder="التكلفة ₪" className={inputCls} />
                    </div>
                  </ActionForm>
                </details>
              </Card>
            );
          })}
          <Card title="إضافة معدّة">
            <ActionForm action={saveEquipment} submitLabel="إضافة" kind="primary" resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="الاسم"><input name="name" required maxLength={200} className={inputCls} /></Field>
                <Field label="الرقم التسلسلي"><input name="serial" dir="ltr" maxLength={120} className={inputCls} /></Field>
              </div>
            </ActionForm>
          </Card>
        </div>
      )}
      <Pagination base="/admin/equipment" page={page} total={count ?? 0} size={SIZE} params={params} />
    </>
  );
}
