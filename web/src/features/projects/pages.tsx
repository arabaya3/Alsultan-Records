import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, ALL_STAFF, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, btn, Card, DL, Field, FilterChips, inputCls, LoadError, Notice, PageHeader, Pagination, RowLink, SearchBox, Table } from "@/features/admin/ui";
import { cleanSearch, one, pageOf, PAGE_SIZE, pick, rangeOf, type IdParams, type SP } from "@/features/admin/query";
import { fmtDate, fmtDateTime } from "@/features/admin/format";
import { formatMinor } from "@/features/admin/money";
import { CONSENT_STATUS, DELIVERABLE_KIND, DELIVERABLE_STATUS, EQUIPMENT_STATUS, EVENT_STATUS, EVENT_TYPES, eventTypeLabel } from "@/features/admin/labels";
import { isUuid } from "@/features/admin/result";
import { Constants } from "@/types/database";
import { createDeliverable } from "@/features/projects/production-actions";
import {
  assignEquipment,
  assignStaff,
  cleanupPublic,
  createEvent,
  deleteEvent,
  removeEquipmentAssignment,
  returnEquipment,
  setConsent,
  setPublication,
  unassignStaff,
  updateEvent,
} from "./actions";

const EVENT_LIST_COLS = "id, title, event_type, event_date, city, status, publication_consent, is_published, customer_id";

export async function EventsList({ searchParams }: { searchParams: SP }) {
  const session = await guard(ALL_STAFF);
  if (!session) return <Forbidden />;
  const sp = await searchParams;
  const status = pick(one(sp.status), Constants.public.Enums.event_status);
  const q = cleanSearch(one(sp.q));
  const page = pageOf(sp.page);
  const sb = await createClient();
  let query = sb.from("events").select(EVENT_LIST_COLS, { count: "exact" }).order("event_date", { ascending: false, nullsFirst: false });
  if (status) query = query.eq("status", status);
  if (q) query = query.or(`title.ilike.*${q}*,city.ilike.*${q}*,venue.ilike.*${q}*`);
  const { data, count, error } = await query.range(...rangeOf(page));
  const params = { status: status ?? "", q };
  return (
    <>
      <PageHeader
        title="المناسبات"
        lead={session.role === "staff" ? "المناسبات المكلّف بها فقط." : undefined}
        actions={session.role !== "staff" ? <Link className={btn("primary")} href="/admin/events/new">مناسبة جديدة</Link> : null}
      />
      <FilterChips
        base="/admin/events"
        param="status"
        current={status ?? ""}
        params={params}
        options={Constants.public.Enums.event_status.map((s) => ({ value: s, label: EVENT_STATUS[s] }))}
      />
      <SearchBox base="/admin/events" q={q} params={params} placeholder="بحث بالعنوان أو المدينة أو المكان" />
      {error ? (
        <LoadError what="المناسبات" />
      ) : (
        <>
          <Table head={["المناسبة", "النوع", "التاريخ", "المدينة", "الحالة", "النشر"]} empty={!data?.length}>
            {data?.map((e) => (
              <tr key={e.id}>
                <td><RowLink href={`/admin/events/${e.id}`}>{e.title}</RowLink></td>
                <td>{eventTypeLabel(e.event_type)}</td>
                <td>{fmtDate(e.event_date)}</td>
                <td>{e.city ?? "—"}</td>
                <td><Badge>{EVENT_STATUS[e.status]}</Badge></td>
                <td>{e.is_published ? <Badge tone="success">منشورة</Badge> : <Badge>{CONSENT_STATUS[e.publication_consent]}</Badge>}</td>
              </tr>
            ))}
          </Table>
          <Pagination base="/admin/events" page={page} total={count ?? 0} size={PAGE_SIZE} params={params} />
        </>
      )}
    </>
  );
}

type EventRow = {
  title: string;
  event_type: string | null;
  event_date: string | null;
  venue: string | null;
  city: string | null;
  status: (typeof Constants.public.Enums.event_status)[number];
  public_slug: string | null;
  seo_title: string | null;
  seo_description: string | null;
  highlight: string | null;
  coverage_notes: string | null;
};

function EventFields({ e, notes }: { e?: EventRow; notes?: { production_note: string | null; equipment_note: string | null } | null }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="العنوان" className="sm:col-span-2"><input name="title" required maxLength={200} defaultValue={e?.title} className={inputCls} /></Field>
        <Field label="النوع">
          <select name="event_type" defaultValue={e?.event_type ?? "wedding"} className={inputCls}>
            {Object.entries(EVENT_TYPES).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
            {e?.event_type && !EVENT_TYPES[e.event_type] ? <option value={e.event_type}>{e.event_type}</option> : null}
          </select>
        </Field>
        <Field label="التاريخ"><input name="event_date" type="date" defaultValue={e?.event_date ?? ""} className={inputCls} /></Field>
        <Field label="المكان"><input name="venue" maxLength={200} defaultValue={e?.venue ?? ""} className={inputCls} /></Field>
        <Field label="المدينة"><input name="city" maxLength={120} defaultValue={e?.city ?? ""} className={inputCls} /></Field>
        <Field label="الحالة">
          <select name="status" defaultValue={e?.status ?? "planned"} className={inputCls}>
            {Constants.public.Enums.event_status.map((s) => (
              <option key={s} value={s}>{EVENT_STATUS[s]}</option>
            ))}
          </select>
        </Field>
      </div>
      <details className="rounded-md border border-cream-line p-3" open={!!e?.public_slug}>
        <summary className="cursor-pointer text-sm font-medium">صفحة العمل العامة والظهور في البحث</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="الرابط العام" hint="مثال: wedding-ahmad-2026 — أحرف إنجليزية صغيرة وأرقام وشرطات.">
            <input name="public_slug" dir="ltr" maxLength={120} pattern="[a-z0-9]+(-[a-z0-9]+)*" defaultValue={e?.public_slug ?? ""} className={inputCls} data-testid="public-slug" />
          </Field>
          <Field label="عنوان البحث (SEO)"><input name="seo_title" maxLength={120} defaultValue={e?.seo_title ?? ""} className={inputCls} /></Field>
          <Field label="وصف البحث (SEO)" className="sm:col-span-2"><textarea name="seo_description" rows={2} maxLength={320} defaultValue={e?.seo_description ?? ""} className={inputCls} /></Field>
          <Field label="سطر مميز (دراسة الحالة)" className="sm:col-span-2"><input name="highlight" maxLength={500} defaultValue={e?.highlight ?? ""} className={inputCls} /></Field>
          <Field label="تفاصيل التغطية (دراسة الحالة)" className="sm:col-span-2"><textarea name="coverage_notes" rows={4} maxLength={5000} defaultValue={e?.coverage_notes ?? ""} className={inputCls} /></Field>
        </div>
      </details>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ملاحظة إنتاج (داخلية)"><textarea name="production_note" rows={3} maxLength={5000} defaultValue={notes?.production_note ?? ""} className={inputCls} /></Field>
        <Field label="ملاحظة معدات (داخلية)"><textarea name="equipment_note" rows={3} maxLength={5000} defaultValue={notes?.equipment_note ?? ""} className={inputCls} /></Field>
      </div>
    </>
  );
}

export async function EventNew({ searchParams }: { searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sp = await searchParams;
  const preset = one(sp.customer);
  const sb = await createClient();
  const { data: customers } = await sb.from("customers").select("id, full_name, phone").order("created_at", { ascending: false }).limit(300);
  return (
    <>
      <PageHeader title="مناسبة جديدة" back={{ href: "/admin/events", label: "المناسبات" }} />
      <Card>
        <ActionForm action={createEvent} submitLabel="إنشاء المناسبة" kind="primary">
          <Field label="العميل" hint="لعميل غير موجود أضفه أولاً من صفحة العملاء.">
            <select name="customer_id" required defaultValue={isUuid(preset) ? preset : ""} className={inputCls}>
              <option value="" disabled>اختر العميل</option>
              {customers?.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name}{c.phone ? ` · ${c.phone}` : ""}</option>
              ))}
            </select>
          </Field>
          <EventFields />
        </ActionForm>
      </Card>
    </>
  );
}

export async function EventDetail({ params }: { params: IdParams }) {
  const session = await guard(ALL_STAFF);
  if (!session) return <Forbidden />;
  const isAdmin = session.role !== "staff";
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sb = await createClient();
  const evRes = await sb
    .from("events")
    .select("id, customer_id, booking_request_id, title, event_type, event_date, venue, city, status, public_slug, publication_consent, consent_at, is_published, featured, featured_order, seo_title, seo_description, highlight, coverage_notes")
    .eq("id", id)
    .maybeSingle();
  if (evRes.error) return <LoadError what="المناسبة" />;
  if (!evRes.data) notFound();
  const ev = evRes.data;

  const [notes, customer, assigns, staff, eqAssigns, equipment, deliverables, mediaCount, publicLeft, fin] = await Promise.all([
    sb.from("event_internal_notes").select("production_note, equipment_note").eq("event_id", id).maybeSingle(),
    sb.from("customers").select("id, full_name, phone").eq("id", ev.customer_id).maybeSingle(),
    sb.from("event_staff_assignments").select("id, role_label, override_reason, staff_members(id, full_name)").eq("event_id", id),
    isAdmin ? sb.from("staff_members").select("id, full_name, specialty").eq("active", true).order("full_name") : Promise.resolve({ data: [] as { id: string; full_name: string; specialty: string | null }[] }),
    sb.from("equipment_assignments").select("id, out_at, returned_at, equipment(id, name, serial)").eq("event_id", id).order("out_at", { ascending: false }),
    isAdmin ? sb.from("equipment").select("id, name, serial, status").neq("status", "retired").order("name") : Promise.resolve({ data: [] as { id: string; name: string; serial: string | null; status: "available" }[] }),
    sb.from("deliverables").select("id, kind, title, status, due_at").eq("event_id", id).order("created_at"),
    sb.from("media_assets").select("id", { count: "exact", head: true }).eq("event_id", id).eq("bucket", "private-media"),
    sb.from("media_assets").select("id", { count: "exact", head: true }).eq("event_id", id).eq("bucket", "public-media"),
    isAdmin ? sb.rpc("event_financials", { p_event_id: id }) : Promise.resolve({ data: null }),
  ]);
  const isPublic = ev.is_published && ev.publication_consent === "granted";
  const consentOk = ev.publication_consent === "granted";
  const f = fin.data?.[0];

  return (
    <>
      <PageHeader
        title={ev.title}
        lead={<>{eventTypeLabel(ev.event_type)} · {fmtDate(ev.event_date)} · {customer.data?.full_name ?? ""}</>}
        back={{ href: "/admin/events", label: "المناسبات" }}
        actions={
          <>
            <Badge>{EVENT_STATUS[ev.status]}</Badge>
            {isPublic ? <Badge tone="success">منشورة</Badge> : null}
            <Link className={btn("primary")} href={`/admin/events/${id}/media`}>الوسائط ({mediaCount.count ?? 0})</Link>
          </>
        }
      />
      {!isPublic && (publicLeft.count ?? 0) > 0 && isAdmin ? (
        <div className="mb-4">
          <Notice tone="danger">
            توجد {publicLeft.count} نسخة عامة من صور هذه المناسبة رغم أنها غير منشورة (مثلاً بعد سحب العميل لموافقته). يجب إزالتها.
            <ActionForm action={cleanupPublic} submitLabel="إزالة النسخ العامة الآن" kind="danger" inline className="mt-2">
              <input type="hidden" name="id" value={id} />
            </ActionForm>
          </Notice>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card title="بيانات المناسبة">
            {isAdmin ? (
              <ActionForm action={updateEvent} submitLabel="حفظ التغييرات" testId="event-form">
                <input type="hidden" name="id" value={id} />
                <EventFields e={ev} notes={notes.data} />
              </ActionForm>
            ) : (
              <DL
                items={[
                  ["المكان", [ev.venue, ev.city].filter(Boolean).join(" · ") || "—"],
                  ["ملاحظة إنتاج", notes.data?.production_note ?? "—"],
                  ["ملاحظة معدات", notes.data?.equipment_note ?? "—"],
                ]}
              />
            )}
          </Card>
          <Card title="التسليمات">
            {deliverables.data?.length ? (
              <ul className="mb-3 divide-y divide-cream-line text-sm">
                {deliverables.data.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <RowLink href={`/admin/production/${d.id}`}>{d.title}</RowLink>
                    <span className="flex items-center gap-2 text-on-cream-muted">
                      {DELIVERABLE_KIND[d.kind]} · {fmtDate(d.due_at)} <Badge>{DELIVERABLE_STATUS[d.status]}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-sm text-on-cream-muted">لا توجد تسليمات بعد.</p>
            )}
            <ActionForm action={createDeliverable} submitLabel="إضافة تسليم" resetOnSuccess>
              <input type="hidden" name="event_id" value={id} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="العنوان"><input name="title" required maxLength={200} className={inputCls} /></Field>
                <Field label="النوع">
                  <select name="kind" className={inputCls}>
                    {Constants.public.Enums.deliverable_kind.map((k) => (
                      <option key={k} value={k}>{DELIVERABLE_KIND[k]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="موعد التسليم"><input name="due_at" type="date" className={inputCls} /></Field>
              </div>
            </ActionForm>
          </Card>
        </div>

        <div className="space-y-4">
          {isAdmin ? (
            <Card title="الموافقة والنشر" id="publication">
              <DL
                items={[
                  ["موافقة العميل", <Badge key="c" tone={consentOk ? "success" : "neutral"}>{CONSENT_STATUS[ev.publication_consent]}</Badge>],
                  ["آخر تغيير", fmtDateTime(ev.consent_at)],
                  ["الرابط العام", ev.public_slug ? <span key="s" dir="ltr">/work/{ev.public_slug}</span> : "غير محدد"],
                ]}
              />
              <ActionForm action={setConsent} submitLabel="تحديث الموافقة" className="mt-3" testId="consent-form">
                <input type="hidden" name="id" value={id} />
                <Field label="حالة الموافقة" hint="سجّل الموافقة فقط إن حصلت عليها من العميل فعلاً. سحبها يوقف النشر ويزيل النسخ العامة.">
                  <select name="consent" defaultValue={ev.publication_consent} className={inputCls} data-testid="consent-select">
                    {Constants.public.Enums.consent_status.map((s) => (
                      <option key={s} value={s}>{CONSENT_STATUS[s]}</option>
                    ))}
                  </select>
                </Field>
              </ActionForm>
              <hr className="my-4 border-cream-line" />
              {!consentOk ? (
                <p className="mb-2 text-sm text-danger" data-testid="publish-blocked">
                  النشر غير متاح: لم يمنح العميل موافقته على نشر هذه المناسبة.
                </p>
              ) : !ev.public_slug ? (
                <p className="mb-2 text-sm text-danger">أضف رابطاً عاماً واحفظه قبل النشر.</p>
              ) : null}
              {ev.is_published ? (
                <ActionForm
                  action={setPublication}
                  submitLabel="إيقاف النشر"
                  kind="danger"
                  confirm={{ title: "إيقاف نشر المناسبة؟", body: "ستختفي من صفحة الأعمال وتُحذف النسخ العامة من صورها." }}
                >
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="publish" value="0" />
                </ActionForm>
              ) : null}
              <ActionForm
                action={setPublication}
                submitLabel={ev.is_published ? "تحديث الإبراز" : "نشر في صفحة الأعمال"}
                kind="primary"
                disabled={!consentOk || !ev.public_slug}
                testId="publish-form"
                className="mt-3"
              >
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="publish" value="1" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="featured" defaultChecked={ev.featured} /> إبراز في الصفحة الرئيسية
                </label>
                <Field label="ترتيب الإبراز"><input name="featured_order" type="number" min={0} max={10000} defaultValue={ev.featured_order ?? ""} className={inputCls} /></Field>
              </ActionForm>
            </Card>
          ) : null}

          <Card title="الطاقم">
            <ul className="mb-3 space-y-2 text-sm">
              {assigns.data?.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {a.staff_members?.full_name ?? "—"} {a.role_label ? <span className="text-on-cream-muted">· {a.role_label}</span> : null}
                    {a.override_reason ? <span className="block text-xs text-danger">حجز مزدوج: {a.override_reason}</span> : null}
                  </span>
                  {isAdmin ? (
                    <ActionForm action={unassignStaff} submitLabel="إزالة" kind="ghost" inline confirm={{ title: "إزالة من طاقم المناسبة؟" }}>
                      <input type="hidden" name="id" value={a.id} />
                    </ActionForm>
                  ) : null}
                </li>
              ))}
              {!assigns.data?.length ? <li className="text-on-cream-muted">لا أحد مكلّف بعد.</li> : null}
            </ul>
            {isAdmin ? (
              <ActionForm action={assignStaff} submitLabel="تكليف" resetOnSuccess testId="assign-staff">
                <input type="hidden" name="event_id" value={id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="الشخص">
                    <select name="staff_id" required className={inputCls}>
                      {staff.data?.map((s) => (
                        <option key={s.id} value={s.id}>{s.full_name}{s.specialty ? ` · ${s.specialty}` : ""}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="الدور"><input name="role_label" maxLength={80} placeholder="مصوّر، مونتاج…" className={inputCls} /></Field>
                </div>
                <Field label="سبب تجاوز التعارض (فقط عند الحجز المزدوج المقصود)">
                  <input name="override_reason" maxLength={500} className={inputCls} />
                </Field>
              </ActionForm>
            ) : null}
          </Card>

          <Card title="المعدات">
            <ul className="mb-3 space-y-2 text-sm">
              {eqAssigns.data?.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {a.equipment?.name ?? "—"}
                    <span className="block text-xs text-on-cream-muted">
                      {fmtDateTime(a.out_at)} ← {a.returned_at ? fmtDateTime(a.returned_at) : "لم تُرجع"}
                    </span>
                  </span>
                  {isAdmin ? (
                    <span className="flex gap-2">
                      {!a.returned_at ? (
                        <ActionForm action={returnEquipment} submitLabel="تسجيل الإرجاع" kind="ghost" inline>
                          <input type="hidden" name="id" value={a.id} />
                        </ActionForm>
                      ) : null}
                      <ActionForm action={removeEquipmentAssignment} submitLabel="حذف" kind="ghost" inline confirm={{ title: "حذف سجل التسليم هذا؟" }}>
                        <input type="hidden" name="id" value={a.id} />
                      </ActionForm>
                    </span>
                  ) : null}
                </li>
              ))}
              {!eqAssigns.data?.length ? <li className="text-on-cream-muted">لا معدات مسجّلة.</li> : null}
            </ul>
            {isAdmin ? (
              <ActionForm action={assignEquipment} submitLabel="تسليم معدّة" resetOnSuccess>
                <input type="hidden" name="event_id" value={id} />
                <Field label="المعدّة">
                  <select name="equipment_id" required className={inputCls}>
                    {equipment.data?.map((q) => (
                      <option key={q.id} value={q.id}>{q.name}{q.serial ? ` (${q.serial})` : ""} · {EQUIPMENT_STATUS[q.status]}</option>
                    ))}
                  </select>
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="الاستلام"><input name="out_at" type="datetime-local" required defaultValue={ev.event_date ? `${ev.event_date}T08:00` : ""} className={inputCls} /></Field>
                  <Field label="الإرجاع (اختياري)"><input name="returned_at" type="datetime-local" className={inputCls} /></Field>
                </div>
              </ActionForm>
            ) : null}
          </Card>

          {isAdmin && f ? (
            <Card title="الملخص المالي">
              <DL
                items={[
                  ["المتعاقد عليه", formatMinor(f.contracted)],
                  ["المدفوع", formatMinor(f.paid)],
                  ["المسترد", formatMinor(f.refunded)],
                  ["المصاريف", formatMinor(f.expenses)],
                  ["الرصيد المتبقي", <strong key="b" className={f.balance > 0 ? "text-danger" : ""}>{formatMinor(f.balance)}</strong>],
                ]}
              />
            </Card>
          ) : null}
          {session.role === "owner" ? (
            <ActionForm
              action={deleteEvent}
              submitLabel="حذف المناسبة"
              kind="danger"
              confirm={{ title: "حذف المناسبة نهائياً؟", body: "تُحذف معها الوسائط والتسليمات. يُفضّل تغيير الحالة إلى «مؤرشف» بدلاً من الحذف.", confirmLabel: "حذف نهائي" }}
            >
              <input type="hidden" name="id" value={id} />
            </ActionForm>
          ) : null}
        </div>
      </div>
    </>
  );
}
