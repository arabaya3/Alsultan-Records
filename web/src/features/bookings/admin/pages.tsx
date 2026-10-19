import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, DL, Field, FilterChips, inputCls, LoadError, PageHeader, Pagination, RowLink, SearchBox, Table, type Tone } from "@/features/admin/ui";
import { cleanSearch, one, pageOf, PAGE_SIZE, pick, rangeOf, type IdParams, type SP } from "@/features/admin/query";
import { fmtDate, fmtDateTime } from "@/features/admin/format";
import { BOOKING_STATUS, BOOKING_TRANSITIONS, eventTypeLabel } from "@/features/admin/labels";
import { isUuid } from "@/features/admin/result";
import { Constants, type Database } from "@/types/database";
import { convertBooking, transitionBooking } from "./actions";

type BS = Database["public"]["Enums"]["booking_status"];
const tone = (s: BS): Tone => (s === "new" ? "gold" : s === "confirmed" ? "success" : s === "cancelled" || s === "declined" ? "danger" : "neutral");

export async function BookingsList({ searchParams }: { searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sp = await searchParams;
  const status = pick(one(sp.status), Constants.public.Enums.booking_status);
  const q = cleanSearch(one(sp.q));
  const page = pageOf(sp.page);
  const sb = await createClient();
  let query = sb
    .from("booking_requests")
    .select("id, tracking_code, contact_name, contact_phone, event_type, event_date, city, status, created_at", { count: "exact" })
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (q) query = query.or(`contact_name.ilike.*${q}*,contact_phone.ilike.*${q}*,tracking_code.ilike.*${q}*`);
  const { data, count, error } = await query.range(...rangeOf(page));
  const params = { status: status ?? "", q };
  return (
    <>
      <PageHeader title="طلبات الحجز" />
      <FilterChips
        base="/admin/bookings"
        param="status"
        current={status ?? ""}
        params={params}
        options={Constants.public.Enums.booking_status.map((s) => ({ value: s, label: BOOKING_STATUS[s] }))}
      />
      <SearchBox base="/admin/bookings" q={q} params={params} placeholder="بحث بالاسم أو الهاتف أو رمز المتابعة" />
      {error ? (
        <LoadError what="الطلبات" />
      ) : (
        <>
          <Table head={["الاسم", "الهاتف", "النوع", "تاريخ المناسبة", "المدينة", "المرحلة", "وصل"]} empty={!data?.length}>
            {data?.map((b) => (
              <tr key={b.id}>
                <td><RowLink href={`/admin/bookings/${b.id}`}>{b.contact_name}</RowLink></td>
                <td dir="ltr" className="text-end">{b.contact_phone}</td>
                <td>{eventTypeLabel(b.event_type)}</td>
                <td>{fmtDate(b.event_date)}</td>
                <td>{b.city ?? "—"}</td>
                <td><Badge tone={tone(b.status)}>{BOOKING_STATUS[b.status]}</Badge></td>
                <td>{fmtDateTime(b.created_at)}</td>
              </tr>
            ))}
          </Table>
          <Pagination base="/admin/bookings" page={page} total={count ?? 0} size={PAGE_SIZE} params={params} />
        </>
      )}
    </>
  );
}

export async function BookingDetail({ params }: { params: IdParams }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sb = await createClient();
  const [b, hist, ev] = await Promise.all([
    sb
      .from("booking_requests")
      .select("id, tracking_code, customer_id, contact_name, contact_phone, contact_email, event_type, event_date, city, venue, guests, services, message, status, created_at")
      .eq("id", id)
      .maybeSingle(),
    sb.from("booking_stage_history").select("id, from_status, to_status, note, created_at").eq("booking_request_id", id).order("created_at"),
    sb.from("events").select("id, title").eq("booking_request_id", id).limit(1).maybeSingle(),
  ]);
  if (b.error) return <LoadError what="الطلب" />;
  if (!b.data) notFound();
  const bk = b.data;
  const next = BOOKING_TRANSITIONS[bk.status];

  return (
    <>
      <PageHeader
        title={bk.contact_name}
        lead={<>رمز المتابعة <span dir="ltr">{bk.tracking_code}</span></>}
        back={{ href: "/admin/bookings", label: "طلبات الحجز" }}
        actions={<Badge tone={tone(bk.status)}>{BOOKING_STATUS[bk.status]}</Badge>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="تفاصيل الطلب">
          <DL
            items={[
              ["الهاتف", <span key="p" dir="ltr">{bk.contact_phone}</span>],
              ["البريد", bk.contact_email ?? "—"],
              ["النوع", eventTypeLabel(bk.event_type)],
              ["التاريخ", fmtDate(bk.event_date)],
              ["المدينة / المكان", [bk.city, bk.venue].filter(Boolean).join(" · ") || "—"],
              ["عدد الضيوف", bk.guests ?? "—"],
              ["الخدمات", bk.services.length ? bk.services.join("، ") : "—"],
              ["الرسالة", bk.message ? <span key="m" className="whitespace-pre-wrap">{bk.message}</span> : "—"],
              ["العميل", bk.customer_id ? <RowLink key="c" href={`/admin/customers/${bk.customer_id}`}>فتح سجل العميل</RowLink> : "غير مرتبط بعد"],
            ]}
          />
        </Card>
        <div className="space-y-4">
          <Card title="نقل إلى مرحلة">
            {next.length ? (
              <ActionForm action={transitionBooking} submitLabel="نقل الطلب" testId="transition-form">
                <input type="hidden" name="id" value={bk.id} />
                <Field label="المرحلة التالية" hint="تظهر فقط المراحل المسموحة من المرحلة الحالية.">
                  <select name="to" required className={inputCls} data-testid="transition-to">
                    {next.map((s) => (
                      <option key={s} value={s}>{BOOKING_STATUS[s]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="ملاحظة (اختياري)"><input name="note" maxLength={2000} className={inputCls} /></Field>
              </ActionForm>
            ) : (
              <p className="text-sm text-on-cream-muted">هذا الطلب في مرحلة نهائية ولا يمكن نقله.</p>
            )}
          </Card>
          <Card title="تحويل إلى مناسبة">
            {ev.data ? (
              <p className="text-sm">
                حُوّل إلى مناسبة: <RowLink href={`/admin/events/${ev.data.id}`}>{ev.data.title}</RowLink>
              </p>
            ) : (
              <ActionForm action={convertBooking} submitLabel="إنشاء العميل والمناسبة" kind="primary">
                <input type="hidden" name="id" value={bk.id} />
                <Field label="عنوان المناسبة" hint={bk.customer_id ? "سيُستخدم سجل العميل المرتبط." : "سيُنشأ سجل عميل من بيانات التواصل."}>
                  <input name="title" maxLength={200} defaultValue={`${bk.contact_name} – ${eventTypeLabel(bk.event_type)}`} className={inputCls} />
                </Field>
              </ActionForm>
            )}
          </Card>
          <Card title="سجل المراحل">
            <ol className="space-y-2 text-sm">
              {hist.data?.map((h) => (
                <li key={h.id} className="flex flex-wrap justify-between gap-2 border-b border-cream-line pb-2 last:border-0">
                  <span>
                    {h.from_status ? `${BOOKING_STATUS[h.from_status]} ← ` : ""}
                    <strong>{BOOKING_STATUS[h.to_status]}</strong>
                    {h.note ? <span className="block text-on-cream-muted">{h.note}</span> : null}
                  </span>
                  <span className="text-on-cream-muted">{fmtDateTime(h.created_at)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
