import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, btn, Card, DL, Field, FilterChips, inputCls, LoadError, PageHeader, Pagination, RowLink, Table } from "@/features/admin/ui";
import { one, pageOf, PAGE_SIZE, pick, rangeOf, type IdParams, type SP } from "@/features/admin/query";
import { fmtDate } from "@/features/admin/format";
import { formatMinor, minorToInput } from "@/features/admin/money";
import { CONTRACT_STATUS, QUOTE_STATUS } from "@/features/admin/labels";
import { isUuid } from "@/features/admin/result";
import { Constants } from "@/types/database";
import { createContractFromQuote } from "@/features/contracts/actions";
import { addQuoteItem, createQuote, deleteQuote, removeQuoteItem, setQuoteStatus, updateQuote } from "./actions";

export async function QuotesList({ searchParams }: { searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sp = await searchParams;
  const status = pick(one(sp.status), Constants.public.Enums.quote_status);
  const page = pageOf(sp.page);
  const sb = await createClient();
  let query = sb
    .from("quotes")
    .select("id, quote_no, status, total, currency, valid_until, created_at, customers(full_name), events(title)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, count, error } = await query.range(...rangeOf(page));
  const params = { status: status ?? "" };
  return (
    <>
      <PageHeader title="عروض الأسعار" actions={<Link className={btn("primary")} href="/admin/quotes/new">عرض جديد</Link>} />
      <FilterChips base="/admin/quotes" param="status" current={status ?? ""} params={params} options={Constants.public.Enums.quote_status.map((s) => ({ value: s, label: QUOTE_STATUS[s] }))} />
      {error ? <LoadError /> : (
        <>
          <Table head={["الرقم", "العميل", "المناسبة", "المجموع", "صالح حتى", "الحالة"]} empty={!data?.length}>
            {data?.map((q) => (
              <tr key={q.id}>
                <td dir="ltr" className="text-end"><RowLink href={`/admin/quotes/${q.id}`}>{q.quote_no}</RowLink></td>
                <td>{q.customers?.full_name ?? "—"}</td>
                <td>{q.events?.title ?? "—"}</td>
                <td dir="ltr" className="text-end">{formatMinor(q.total, q.currency)}</td>
                <td>{fmtDate(q.valid_until)}</td>
                <td><Badge tone={q.status === "accepted" ? "success" : q.status === "sent" ? "gold" : "neutral"}>{QUOTE_STATUS[q.status]}</Badge></td>
              </tr>
            ))}
          </Table>
          <Pagination base="/admin/quotes" page={page} total={count ?? 0} size={PAGE_SIZE} params={params} />
        </>
      )}
    </>
  );
}

export async function QuoteNew({ searchParams }: { searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sp = await searchParams;
  const presetEvent = one(sp.event);
  const sb = await createClient();
  const [customers, events] = await Promise.all([
    sb.from("customers").select("id, full_name").order("created_at", { ascending: false }).limit(300),
    sb.from("events").select("id, title, customer_id").order("created_at", { ascending: false }).limit(300),
  ]);
  const preset = events.data?.find((e) => e.id === presetEvent);
  return (
    <>
      <PageHeader title="عرض سعر جديد" back={{ href: "/admin/quotes", label: "عروض الأسعار" }} />
      <Card>
        <ActionForm action={createQuote} submitLabel="إنشاء المسودة" kind="primary">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="العميل">
              <select name="customer_id" required defaultValue={preset?.customer_id ?? ""} className={inputCls}>
                <option value="" disabled>اختر العميل</option>
                {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </Field>
            <Field label="المناسبة (اختياري)" hint="يجب أن تكون للعميل نفسه.">
              <select name="event_id" defaultValue={preset?.id ?? ""} className={inputCls}>
                <option value="">بدون</option>
                {events.data?.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </Field>
            <Field label="صالح حتى"><input name="valid_until" type="date" className={inputCls} /></Field>
          </div>
          <p className="text-xs text-on-cream-muted">تضيف البنود بعد إنشاء المسودة؛ المجاميع تُحسب تلقائياً.</p>
        </ActionForm>
      </Card>
    </>
  );
}

export async function QuoteDetail({ params }: { params: IdParams }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sb = await createClient();
  const [q, items, contracts] = await Promise.all([
    sb.from("quotes").select("id, quote_no, status, currency, subtotal, discount, total, valid_until, accepted_at, customer_id, event_id, customers(full_name), events(title)").eq("id", id).maybeSingle(),
    sb.from("quote_items").select("id, description, qty, unit_price, line_total").eq("quote_id", id).order("sort_order"),
    sb.from("contracts").select("id, status, created_at").eq("quote_id", id).order("created_at"),
  ]);
  if (q.error) return <LoadError />;
  if (!q.data) notFound();
  const quote = q.data;
  const draft = quote.status === "draft";
  return (
    <>
      <PageHeader
        title={`عرض ${quote.quote_no}`}
        lead={<>{quote.customers?.full_name}{quote.events ? ` · ${quote.events.title}` : ""}</>}
        back={{ href: "/admin/quotes", label: "عروض الأسعار" }}
        actions={<Badge tone={quote.status === "accepted" ? "success" : "neutral"}>{QUOTE_STATUS[quote.status]}</Badge>}
      />
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card title="البنود">
          <Table head={["الوصف", "الكمية", "سعر الوحدة", "المجموع", ""]} empty={!items.data?.length}>
            {items.data?.map((it) => (
              <tr key={it.id}>
                <td>{it.description}</td>
                <td>{it.qty}</td>
                <td dir="ltr" className="text-end">{formatMinor(it.unit_price, quote.currency)}</td>
                <td dir="ltr" className="text-end">{formatMinor(it.line_total, quote.currency)}</td>
                <td>
                  {draft ? (
                    <ActionForm action={removeQuoteItem} submitLabel="حذف" kind="ghost" inline>
                      <input type="hidden" name="id" value={it.id} />
                    </ActionForm>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
          {draft ? (
            <ActionForm action={addQuoteItem} submitLabel="إضافة بند" resetOnSuccess className="mt-4" testId="add-item">
              <input type="hidden" name="quote_id" value={quote.id} />
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                <Field label="الوصف"><input name="description" required maxLength={500} className={inputCls} /></Field>
                <Field label="الكمية"><input name="qty" defaultValue="1" inputMode="decimal" dir="ltr" className={inputCls} /></Field>
                <Field label="سعر الوحدة (₪)"><input name="unit_price" required inputMode="decimal" dir="ltr" placeholder="1500.00" className={inputCls} /></Field>
              </div>
            </ActionForm>
          ) : (
            <p className="mt-3 text-xs text-on-cream-muted">البنود مقفلة لأن العرض لم يعد مسودة.</p>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="المجاميع">
            <DL
              items={[
                ["المجموع الفرعي", formatMinor(quote.subtotal, quote.currency)],
                ["الخصم", formatMinor(quote.discount, quote.currency)],
                ["الإجمالي", <strong key="t">{formatMinor(quote.total, quote.currency)}</strong>],
                ["صالح حتى", fmtDate(quote.valid_until)],
                ["قُبل في", fmtDate(quote.accepted_at)],
              ]}
            />
            {draft ? (
              <ActionForm action={updateQuote} submitLabel="حفظ" className="mt-3">
                <input type="hidden" name="id" value={quote.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="الخصم (₪)"><input name="discount" inputMode="decimal" dir="ltr" defaultValue={minorToInput(quote.discount)} className={inputCls} /></Field>
                  <Field label="صالح حتى"><input name="valid_until" type="date" defaultValue={quote.valid_until ?? ""} className={inputCls} /></Field>
                </div>
              </ActionForm>
            ) : null}
          </Card>
          <Card title="الحالة">
            <div className="flex flex-wrap gap-2">
              {draft ? (
                <ActionForm action={setQuoteStatus} submitLabel="إرسال للعميل" kind="primary" inline confirm={{ title: "إرسال العرض للعميل؟", body: "بعد الإرسال تُقفل البنود والمبالغ ويظهر العرض في بوابة العميل." }}>
                  <input type="hidden" name="id" value={quote.id} /><input type="hidden" name="to" value="sent" />
                </ActionForm>
              ) : null}
              {quote.status === "sent" ? (
                <>
                  <ActionForm action={setQuoteStatus} submitLabel="تعليم كمرفوض" kind="ghost" inline>
                    <input type="hidden" name="id" value={quote.id} /><input type="hidden" name="to" value="rejected" />
                  </ActionForm>
                  <ActionForm action={setQuoteStatus} submitLabel="إعادة لمسودة" kind="ghost" inline>
                    <input type="hidden" name="id" value={quote.id} /><input type="hidden" name="to" value="draft" />
                  </ActionForm>
                </>
              ) : null}
              {draft ? (
                <ActionForm action={deleteQuote} submitLabel="حذف المسودة" kind="danger" inline confirm={{ title: "حذف مسودة العرض؟" }}>
                  <input type="hidden" name="id" value={quote.id} />
                </ActionForm>
              ) : null}
            </div>
          </Card>
          <Card title="العقود">
            {contracts.data?.length ? (
              <ul className="mb-3 space-y-1 text-sm">
                {contracts.data.map((c) => (
                  <li key={c.id}><RowLink href={`/admin/contracts/${c.id}`}>عقد {fmtDate(c.created_at)}</RowLink> <Badge>{CONTRACT_STATUS[c.status]}</Badge></li>
                ))}
              </ul>
            ) : null}
            {quote.status === "sent" || quote.status === "accepted" ? (
              <ActionForm action={createContractFromQuote} submitLabel="إنشاء عقد من هذا العرض" testId="contract-from-quote">
                <input type="hidden" name="quote_id" value={quote.id} />
                <Field label="نص العقد"><textarea name="body" required minLength={10} rows={6} className={inputCls} /></Field>
                <Field label="العربون المطلوب (₪)"><input name="deposit" inputMode="decimal" dir="ltr" defaultValue="0" className={inputCls} /></Field>
                <p className="text-xs text-on-cream-muted">قيمة العقد = إجمالي العرض ({formatMinor(quote.total, quote.currency)}).</p>
              </ActionForm>
            ) : (
              <p className="text-sm text-on-cream-muted">يمكن إنشاء عقد بعد إرسال العرض.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
