import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, btn, Card, DL, Field, inputCls, LoadError, PageHeader, Pagination, RowLink, SearchBox, Table } from "@/features/admin/ui";
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
  return (
    <>
      <PageHeader title="العملاء" actions={<Link className={btn("primary")} href="/admin/customers/new">عميل جديد</Link>} />
      <SearchBox base="/admin/customers" q={q} params={params} />
      {error ? (
        <LoadError what="العملاء" />
      ) : (
        <>
          <Table head={["الاسم", "الهاتف", "البريد", "المدينة", "حساب البوابة", "أُضيف"]} empty={!data?.length}>
            {data?.map((c) => (
              <tr key={c.id}>
                <td><RowLink href={`/admin/customers/${c.id}`}>{c.full_name}</RowLink></td>
                <td dir="ltr" className="text-end">{c.phone ?? "—"}</td>
                <td dir="ltr" className="text-end">{c.email ?? "—"}</td>
                <td>{c.city ?? "—"}</td>
                <td>{c.user_id ? <Badge tone="success">مرتبط</Badge> : <Badge>بدون حساب</Badge>}</td>
                <td>{fmtDate(c.created_at)}</td>
              </tr>
            ))}
          </Table>
          <Pagination base="/admin/customers" page={page} total={count ?? 0} size={PAGE_SIZE} params={params} />
        </>
      )}
    </>
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
