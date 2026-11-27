import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, btn, Card, DL, EmptyState, Field, inputCls, LoadError, PageHeader, Pagination, RowLink, SearchBox } from "@/features/admin/ui";
import { Modal, ModalCancel } from "@/features/admin/Modal";
import { StatusPill } from "@/features/admin/StatusPill";
import { IconCalendar, IconEdit, IconEye, IconLink, IconMail, IconPhone, IconPinMap, IconPlus, IconUsers } from "@/features/admin/icons";
import { cleanSearch, one, pageOf, PAGE_SIZE, rangeOf, type IdParams, type SP } from "@/features/admin/query";
import { fmtDate } from "@/features/admin/format";
import { EVENT_STATUS, eventTypeLabel } from "@/features/admin/labels";
import { isUuid } from "@/features/admin/result";
import { createCustomer, deleteCustomer, linkCustomerUser, updateCustomer, updateCustomerNotes } from "./actions";

const CUSTOMER_COLS = "id, user_id, full_name, phone, email, city, created_at";

export async function CustomersList({ searchParams }: { searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sp = await searchParams;
  const q = cleanSearch(one(sp.q));
  const page = pageOf(sp.page);
  const sb = await createClient();
  let query = sb.from("customers").select(CUSTOMER_COLS, { count: "exact" }).order("created_at", { ascending: false });
  if (q) query = query.or(`full_name.ilike.*${q}*,phone.ilike.*${q}*,email.ilike.*${q}*`);
  const { data, count, error } = await query.range(...rangeOf(page));
  const params = { q };
  const cols = "md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_7rem_8rem_7.5rem_10rem]";
  return (
    <>
      <PageHeader
        title="العملاء"
        lead="ابحث عن العملاء وراجع بياناتهم بسهولة."
        actions={
          <Link className={btn("primary", "px-6 text-base")} href="/admin/customers/new">
            <IconPlus /> عميل جديد
          </Link>
        }
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <SearchBox base="/admin/customers" q={q} params={params} placeholder="ابحث بالاسم أو الهاتف أو البريد" />
        {!error ? (
          <p className="text-sm text-on-cream-muted" data-testid="customers-count">
            {(count ?? 0).toLocaleString("en-US")} عميل
          </p>
        ) : null}
      </div>
      {error ? (
        <LoadError what="العملاء" />
      ) : data?.length ? (
        <>
          <div className="overflow-hidden rounded-2xl border border-cream-line bg-[#fffdf8] shadow-[0_8px_24px_-20px_rgb(60_45_20/0.4)]">
            <div aria-hidden="true" className={`hidden gap-3 bg-cream-2 px-5 py-3 text-sm font-semibold text-on-cream-muted md:grid ${cols}`}>
              <span>الاسم</span>
              <span>بيانات التواصل</span>
              <span>المدينة</span>
              <span>حالة الحساب</span>
              <span>تاريخ الإضافة</span>
              <span />
            </div>
            <ul aria-label="العملاء" className="divide-y divide-cream-line" data-testid="customers-list">
              {data.map((c) => (
                <li key={c.id} className={`grid items-center gap-x-3 gap-y-2 px-5 py-3 ${cols}`} data-testid="customer-row">
                  <span className="flex min-w-0 items-center gap-3">
                    <span aria-hidden="true" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-gold/30 font-display text-lg font-bold text-gold-text">
                      {initial(c.full_name)}
                    </span>
                    <RowLink href={`/admin/customers/${c.id}`}>{c.full_name}</RowLink>
                  </span>
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    {c.email ? (
                      <>
                        <span className="shrink-0 text-on-cream-muted"><IconMail /></span>
                        <span dir="ltr" className="truncate" title={c.email}>{c.email}</span>
                      </>
                    ) : c.phone ? (
                      <>
                        <span className="shrink-0 text-on-cream-muted"><IconPhone /></span>
                        <span dir="ltr">{c.phone}</span>
                      </>
                    ) : (
                      <span className="text-on-cream-muted">—</span>
                    )}
                  </span>
                  <span className="text-sm">{c.city ?? "—"}</span>
                  <span>
                    {c.user_id ? <StatusPill tone="success" label="مرتبط" icon={<IconLink size={14} />} /> : <StatusPill label="بدون حساب" icon={null} />}
                  </span>
                  <span className="text-sm" dir="ltr" style={{ textAlign: "end" }}>{fmtDate(c.created_at)}</span>
                  <span className="md:justify-self-end">
                    <Modal
                      title="بيانات العميل"
                      size="sm"
                      testId={`customer-${c.id}`}
                      trigger={
                        <>
                          <IconEye size={16} /> عرض التفاصيل
                        </>
                      }
                      triggerClassName="inline-flex min-h-11 items-center gap-2 rounded-lg border border-cream-line bg-[#fffdf8] px-3 text-sm font-semibold hover:border-on-cream-muted"
                    >
                      <div className="flex flex-col items-center text-center">
                        <span aria-hidden="true" className="inline-flex size-16 items-center justify-center rounded-full bg-gold/30 font-display text-2xl font-bold text-gold-text">
                          {initial(c.full_name)}
                        </span>
                        <p className="mt-2 font-display text-xl font-bold">{c.full_name}</p>
                      </div>
                      <dl className="mt-4 divide-y divide-cream-line rounded-xl border border-cream-line bg-[#fffdf8] text-sm">
                        <Detail icon={<IconPhone />} label="الهاتف" value={c.phone ? <span dir="ltr">{c.phone}</span> : "—"} />
                        <Detail icon={<IconMail />} label="البريد" value={c.email ? <span dir="ltr" className="break-all">{c.email}</span> : "—"} />
                        <Detail icon={<IconPinMap />} label="المدينة" value={c.city ?? "—"} />
                        <Detail icon={<IconCalendar />} label="تاريخ الإضافة" value={<span dir="ltr">{fmtDate(c.created_at)}</span>} />
                        <Detail icon={<IconLink />} label="حالة الحساب" value={c.user_id ? <StatusPill tone="success" label="مرتبط" icon={<IconLink size={14} />} /> : <StatusPill label="بدون حساب" icon={null} />} />
                      </dl>
                      <div className="mt-5 flex flex-wrap justify-between gap-2">
                        <Link href={`/admin/customers/${c.id}`} className={btn("primary", "px-6")}>
                          <IconEdit size={16} /> تعديل البيانات
                        </Link>
                        <ModalCancel label="إغلاق" />
                      </div>
                    </Modal>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <Pagination base="/admin/customers" page={page} total={count ?? 0} size={PAGE_SIZE} params={params} />
        </>
      ) : (
        <div className="rounded-2xl border border-cream-line bg-[#fffdf8]">
          <EmptyState icon={<IconUsers size={40} />} title={q ? "لا يوجد عملاء مطابقون" : "لا يوجد عملاء بعد"} body={q ? "جرّب الاسم أو الهاتف أو البريد بطريقة أخرى." : "أضف أول عميل من «عميل جديد»."} />
        </div>
      )}
    </>
  );
}

const initial = (name: string) => (name.replace(/^\[[^\]]*\]\s*/, "").trim()[0] ?? "؟").toUpperCase();

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="flex items-center gap-2 text-on-cream-muted">
        <span aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd className="min-w-0 text-end font-medium">{value}</dd>
    </div>
  );
}

function CustomerFields({ c }: { c?: { full_name: string; phone: string | null; email: string | null; city: string | null } }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="الاسم الكامل"><input name="full_name" required maxLength={200} defaultValue={c?.full_name} className={inputCls} /></Field>
      <Field label="الهاتف"><input name="phone" dir="ltr" maxLength={32} defaultValue={c?.phone ?? ""} className={inputCls} /></Field>
      <Field label="البريد الإلكتروني"><input name="email" type="email" dir="ltr" defaultValue={c?.email ?? ""} className={inputCls} /></Field>
      <Field label="المدينة"><input name="city" maxLength={120} defaultValue={c?.city ?? ""} className={inputCls} /></Field>
    </div>
  );
}

export async function CustomerNew() {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  return (
    <>
      <PageHeader title="عميل جديد" back={{ href: "/admin/customers", label: "العملاء" }} />
      <Card>
        <ActionForm action={createCustomer} submitLabel="حفظ العميل" kind="primary">
          <CustomerFields />
          <Field label="ملاحظات داخلية (لا يراها العميل)"><textarea name="notes" rows={3} className={inputCls} /></Field>
        </ActionForm>
      </Card>
    </>
  );
}

export async function CustomerDetail({ params }: { params: IdParams }) {
  const session = await guard(ADMIN_ROLES);
  if (!session) return <Forbidden />;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sb = await createClient();
  const [c, notes, events, profiles] = await Promise.all([
    sb.from("customers").select(CUSTOMER_COLS).eq("id", id).maybeSingle(),
    sb.from("customer_internal_notes").select("notes").eq("customer_id", id).maybeSingle(),
    sb.from("events").select("id, title, event_type, event_date, status").eq("customer_id", id).order("event_date", { ascending: false }).limit(50),
    sb.from("profiles").select("id, full_name, phone").eq("role", "customer").eq("disabled", false).order("created_at", { ascending: false }).limit(200),
  ]);
  if (c.error) return <LoadError what="العميل" />;
  if (!c.data) notFound();
  const cust = c.data;
  const linked = profiles.data?.find((p) => p.id === cust.user_id);

  return (
    <>
      <PageHeader
        title={cust.full_name}
        back={{ href: "/admin/customers", label: "العملاء" }}
        actions={<Link className={btn("primary")} href={`/admin/events/new?customer=${cust.id}`}>مناسبة جديدة</Link>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="بيانات التواصل">
          <ActionForm action={updateCustomer} submitLabel="حفظ">
            <input type="hidden" name="id" value={cust.id} />
            <CustomerFields c={cust} />
          </ActionForm>
        </Card>
        <Card title="ملاحظات داخلية">
          <ActionForm action={updateCustomerNotes} submitLabel="حفظ الملاحظات">
            <input type="hidden" name="id" value={cust.id} />
            <label className="sr-only" htmlFor="cust-notes">ملاحظات</label>
            <textarea id="cust-notes" name="notes" rows={6} defaultValue={notes.data?.notes ?? ""} className={inputCls} />
            <p className="text-xs text-on-cream-muted">تظهر للإدارة والطاقم المكلّف فقط، ولا تظهر للعميل.</p>
          </ActionForm>
        </Card>
        <Card title="المناسبات">
          {events.data?.length ? (
            <ul className="divide-y divide-cream-line text-sm">
              {events.data.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <RowLink href={`/admin/events/${e.id}`}>{e.title}</RowLink>
                  <span className="flex items-center gap-2 text-on-cream-muted">
                    {eventTypeLabel(e.event_type)} · {fmtDate(e.event_date)} <Badge>{EVENT_STATUS[e.status]}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-on-cream-muted">لا توجد مناسبات بعد.</p>
          )}
        </Card>
        <Card title="حساب بوابة العميل">
          <DL items={[["الحالة", cust.user_id ? `مرتبط${linked ? ` بـ ${linked.full_name ?? ""}` : ""}` : "غير مرتبط بحساب"]]} />
          <ActionForm action={linkCustomerUser} submitLabel={cust.user_id ? "تحديث الربط" : "ربط الحساب"} className="mt-3">
            <input type="hidden" name="id" value={cust.id} />
            <Field label="حساب العميل" hint="تظهر حسابات العملاء المسجلة فقط. اختر «بدون حساب» لإلغاء الربط.">
              <select name="user_id" defaultValue={cust.user_id ?? ""} className={inputCls}>
                <option value="">بدون حساب</option>
                {profiles.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? "بدون اسم"} {p.phone ? `· ${p.phone}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          </ActionForm>
        </Card>
      </div>
      {session.role === "owner" ? (
        <div className="mt-6">
          <ActionForm
            action={deleteCustomer}
            submitLabel="حذف العميل"
            kind="danger"
            confirm={{ title: "حذف هذا العميل؟", body: "لا يمكن التراجع. لن يُسمح بالحذف إن كانت لديه مناسبات أو عروض أو دفعات.", confirmLabel: "حذف نهائي" }}
          >
            <input type="hidden" name="id" value={cust.id} />
          </ActionForm>
        </div>
      ) : null}
    </>
  );
}
