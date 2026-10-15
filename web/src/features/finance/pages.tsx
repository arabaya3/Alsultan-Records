import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, btn, Card, Field, inputCls, LoadError, PageHeader, Pagination, Stat, Table } from "@/features/admin/ui";
import { one, pageOf, rangeOf, type SP } from "@/features/admin/query";
import { fmtDate, todayISO } from "@/features/admin/format";
import { formatMinor } from "@/features/admin/money";
import { DATE_RE } from "@/features/admin/result";
import { addExpense, deleteExpense } from "./actions";
import { PaymentForm } from "./PaymentForm";

const SIZE = 20;

export async function FinancePage({ searchParams }: { searchParams: SP }) {
  // Owner writes, admin reads (RLS enforces the same: payments via owner-only RPC, expenses owner-only writes).
  const session = await guard(ADMIN_ROLES);
  if (!session) return <Forbidden />;
  const isOwner = session.role === "owner";
  const sp = await searchParams;
  const to = DATE_RE.test(one(sp.to)) ? one(sp.to) : todayISO();
  const from = DATE_RE.test(one(sp.from)) ? one(sp.from) : `${to.slice(0, 7)}-01`;
  const ppage = pageOf(sp.ppage);
  const epage = pageOf(sp.epage);
  const sb = await createClient();
  const [summary, payments, expenses, customers, events] = await Promise.all([
    sb.rpc("admin_financial_summary", { p_from: from, p_to: to < from ? from : to }),
    sb
      .from("payments")
      .select("id, kind, amount, currency, method, received_at, reference, customers(full_name), events(title)", { count: "exact" })
      .gte("received_at", from)
      .lt("received_at", `${to}T23:59:59.999Z`)
      .order("received_at", { ascending: false })
      .range(...rangeOf(ppage, SIZE)),
    sb
      .from("expenses")
      .select("id, category, amount, currency, spent_at, note, events(title)", { count: "exact" })
      .gte("spent_at", from)
      .lte("spent_at", to)
      .order("spent_at", { ascending: false })
      .range(...rangeOf(epage, SIZE)),
    isOwner ? sb.from("customers").select("id, full_name").order("full_name").limit(500) : Promise.resolve({ data: [] }),
    isOwner ? sb.from("events").select("id, title, customer_id").order("event_date", { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
  ]);
  const s = summary.data?.[0];
  const params = { from, to, ppage: String(ppage), epage: String(epage) };

  return (
    <>
      <PageHeader title="المالية" lead={isOwner ? undefined : "عرض فقط. التسجيل والتعديل للمالك."} />
      <form method="get" action="/admin/finance" className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="من"><input type="date" name="from" defaultValue={from} className={inputCls} /></Field>
        <Field label="إلى"><input type="date" name="to" defaultValue={to} className={inputCls} /></Field>
        <button type="submit" className={btn("secondary")}>عرض</button>
      </form>
      {summary.error || !s ? (
        <LoadError what="الملخص" />
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="fin-summary">
          <Stat label="عقود معتمدة" value={formatMinor(s.contracted)} />
          <Stat label="مقبوضات" value={formatMinor(s.paid)} />
          <Stat label="مستردات" value={formatMinor(s.refunded)} />
          <Stat label="مصاريف" value={formatMinor(s.expenses)} />
          <Stat label="صافي النقد" value={formatMinor(s.net_cash)} tone={s.net_cash < 0 ? "danger" : undefined} />
          <Stat label="مستحق (كل الفترات)" value={formatMinor(s.outstanding)} tone={s.outstanding > 0 ? "gold" : undefined} />
        </div>
      )}
      {isOwner ? (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <Card title="تسجيل دفعة أو استرداد">
            <PaymentForm customers={customers.data ?? []} events={events.data ?? []} />
          </Card>
          <Card title="تسجيل مصروف">
            <ActionForm action={addExpense} submitLabel="تسجيل المصروف" resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="التصنيف"><input name="category" required maxLength={80} placeholder="معدات، مواصلات…" className={inputCls} /></Field>
                <Field label="المبلغ (₪)"><input name="amount" required inputMode="decimal" dir="ltr" className={inputCls} /></Field>
                <Field label="التاريخ"><input name="spent_at" type="date" className={inputCls} /></Field>
                <Field label="المناسبة (اختياري)">
                  <select name="event_id" defaultValue="" className={inputCls}>
                    <option value="">بدون</option>
                    {(events.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                  </select>
                </Field>
                <Field label="ملاحظة" className="sm:col-span-2"><input name="note" maxLength={1000} className={inputCls} /></Field>
              </div>
            </ActionForm>
          </Card>
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="الدفعات في الفترة">
          {payments.error ? <LoadError /> : (
            <>
              <Table head={["التاريخ", "العميل", "النوع", "المبلغ", "الطريقة"]} empty={!payments.data?.length}>
                {payments.data?.map((p) => (
                  <tr key={p.id} data-testid="payment-row">
                    <td>{fmtDate(p.received_at)}</td>
                    <td>{p.customers?.full_name ?? "—"}{p.events ? <span className="block text-xs text-on-cream-muted">{p.events.title}</span> : null}</td>
                    <td>{p.kind === "refund" ? <Badge tone="danger">استرداد</Badge> : <Badge tone="success">دفعة</Badge>}</td>
                    <td dir="ltr" className="text-end">{formatMinor(p.amount, p.currency)}</td>
                    <td>{p.method}{p.reference ? <span className="block text-xs text-on-cream-muted">{p.reference}</span> : null}</td>
                  </tr>
                ))}
              </Table>
              <Pagination base="/admin/finance" page={ppage} total={payments.count ?? 0} size={SIZE} param="ppage" params={params} />
            </>
          )}
          <p className="mt-2 text-xs text-on-cream-muted">الدفعات لا تُعدّل ولا تُحذف؛ لتصحيح خطأ سجّل استرداداً.</p>
        </Card>
        <Card title="المصاريف في الفترة">
          {expenses.error ? <LoadError /> : (
            <>
              <Table head={["التاريخ", "التصنيف", "المبلغ", ""]} empty={!expenses.data?.length}>
                {expenses.data?.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtDate(e.spent_at)}</td>
                    <td>{e.category}{e.events ? <span className="block text-xs text-on-cream-muted">{e.events.title}</span> : null}{e.note ? <span className="block text-xs text-on-cream-muted">{e.note}</span> : null}</td>
                    <td dir="ltr" className="text-end">{formatMinor(e.amount, e.currency)}</td>
                    <td>
                      {isOwner ? (
                        <ActionForm action={deleteExpense} submitLabel="حذف" kind="ghost" inline confirm={{ title: "حذف هذا المصروف؟", body: "يُسجّل الحذف في سجل التدقيق." }}>
                          <input type="hidden" name="id" value={e.id} />
                        </ActionForm>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </Table>
              <Pagination base="/admin/finance" page={epage} total={expenses.count ?? 0} size={SIZE} param="epage" params={params} />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
