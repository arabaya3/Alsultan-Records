import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, DL, Field, FilterChips, inputCls, LoadError, PageHeader, Pagination, RowLink, Table } from "@/features/admin/ui";
import { one, pageOf, PAGE_SIZE, pick, rangeOf, type IdParams, type SP } from "@/features/admin/query";
import { fmtDateTime } from "@/features/admin/format";
import { SUPPORT_STATUS } from "@/features/admin/labels";
import { isUuid } from "@/features/admin/result";
import { Constants } from "@/types/database";
import { replySupport, setSupportStatus } from "./actions";

export async function SupportList({ searchParams }: { searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sp = await searchParams;
  const status = pick(one(sp.status), Constants.public.Enums.support_status);
  const page = pageOf(sp.page);
  const sb = await createClient();
  let q = sb.from("support_requests").select("id, tracking_code, subject, contact_name, status, created_at, customers(full_name)", { count: "exact" }).order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, count, error } = await q.range(...rangeOf(page));
  const params = { status: status ?? "" };
  return (
    <>
      <PageHeader title="الدعم" />
      <FilterChips base="/admin/support" param="status" current={status ?? ""} params={params} options={Constants.public.Enums.support_status.map((s) => ({ value: s, label: SUPPORT_STATUS[s] }))} />
      {error ? <LoadError /> : (
        <>
          <Table head={["الموضوع", "من", "الرمز", "وصل", "الحالة"]} empty={!data?.length}>
            {data?.map((r) => (
              <tr key={r.id}>
                <td><RowLink href={`/admin/support/${r.id}`}>{r.subject}</RowLink></td>
                <td>{r.customers?.full_name ?? r.contact_name ?? "—"}</td>
                <td dir="ltr" className="text-end">{r.tracking_code}</td>
                <td>{fmtDateTime(r.created_at)}</td>
                <td><Badge tone={r.status === "open" ? "gold" : "neutral"}>{SUPPORT_STATUS[r.status]}</Badge></td>
              </tr>
            ))}
          </Table>
          <Pagination base="/admin/support" page={page} total={count ?? 0} size={PAGE_SIZE} params={params} />
        </>
      )}
    </>
  );
}

export async function SupportDetail({ params }: { params: IdParams }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sb = await createClient();
  const [r, msgs] = await Promise.all([
    sb.from("support_requests").select("id, tracking_code, subject, contact_name, contact_phone, contact_email, status, created_at, customer_id, customers(full_name)").eq("id", id).maybeSingle(),
    sb.from("support_messages").select("id, body, is_staff_reply, created_at").eq("request_id", id).order("created_at"),
  ]);
  if (r.error) return <LoadError />;
  if (!r.data) notFound();
  const req = r.data;
  return (
    <>
      <PageHeader title={req.subject} back={{ href: "/admin/support", label: "الدعم" }} actions={<Badge>{SUPPORT_STATUS[req.status]}</Badge>} />
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card title="المحادثة">
          <ol className="space-y-3">
            {msgs.data?.map((m) => (
              <li key={m.id} className={`max-w-[85%] rounded-md p-3 text-sm ${m.is_staff_reply ? "ms-auto bg-ink text-on-dark" : "bg-cream-2"}`}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className="mt-1 text-xs opacity-70">{m.is_staff_reply ? "الفريق" : "العميل"} · {fmtDateTime(m.created_at)}</p>
              </li>
            ))}
          </ol>
          <ActionForm action={replySupport} submitLabel="إرسال الرد" kind="primary" resetOnSuccess className="mt-4">
            <input type="hidden" name="request_id" value={req.id} />
            <Field label="الرد"><textarea name="body" required rows={4} maxLength={5000} className={inputCls} /></Field>
            <Field label="بعد الإرسال">
              <select name="then_status" defaultValue="pending" className={inputCls}>
                <option value="">إبقاء الحالة</option>
                <option value="pending">بانتظار العميل</option>
                <option value="resolved">تم الحل</option>
              </select>
            </Field>
          </ActionForm>
          {!req.customer_id ? <p className="mt-2 text-xs text-on-cream-muted">الطلب من زائر بلا حساب: تواصل معه هاتفياً أيضاً، فهو يرى الحالة فقط عبر رمز المتابعة.</p> : null}
        </Card>
        <Card title="التفاصيل">
          <DL items={[["الرمز", <span key="c" dir="ltr">{req.tracking_code}</span>], ["الاسم", req.customers?.full_name ?? req.contact_name ?? "—"], ["الهاتف", <span key="p" dir="ltr">{req.contact_phone ?? "—"}</span>], ["البريد", req.contact_email ?? "—"], ["وصل", fmtDateTime(req.created_at)]]} />
          <ActionForm action={setSupportStatus} submitLabel="تحديث الحالة" className="mt-3">
            <input type="hidden" name="id" value={req.id} />
            <select name="status" defaultValue={req.status} aria-label="الحالة" className={inputCls}>
              {Constants.public.Enums.support_status.map((s) => <option key={s} value={s}>{SUPPORT_STATUS[s]}</option>)}
            </select>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
