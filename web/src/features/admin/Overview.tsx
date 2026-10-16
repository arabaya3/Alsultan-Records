import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Forbidden, guard, ALL_STAFF } from "./guard";
import { Card, PageHeader, Stat, Table, RowLink, Badge, LoadError } from "./ui";
import { fmtDate, isoInDays, todayISO } from "./format";
import { formatMinor } from "./money";
import { ActionForm } from "./ActionForm";
import { runStorageCleanup } from "@/features/projects/actions";
import { DELIVERABLE_STATUS, EVENT_STATUS, eventTypeLabel } from "./labels";

/** Actionable alerts only, from real data. Counts use head:true (no rows transferred). */
export async function Overview() {
  const session = await guard(ALL_STAFF);
  if (!session) return <Forbidden />;
  const sb = await createClient();
  const isAdmin = session.role !== "staff";
  const in3 = isoInDays(3);
  const nowIso = isoInDays(0);
  const today = todayISO();

  const dueQ = sb
    .from("deliverables")
    .select("id", { count: "exact", head: true })
    .not("status", "in", "(approved,delivered)")
    .lte("due_at", in3);

  if (!isAdmin) {
    const [due, events] = await Promise.all([
      dueQ,
      sb
        .from("events")
        .select("id, title, event_type, event_date, status")
        .gte("event_date", today)
        .order("event_date")
        .limit(10),
    ]);
    return (
      <>
        <PageHeader title={`أهلاً ${session.fullName ?? ""}`} lead="مناسباتك القادمة والتسليمات القريبة." />
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Stat label="تسليمات خلال ٣ أيام أو متأخرة" value={due.count ?? 0} href="/admin/production?due=soon" tone={(due.count ?? 0) > 0 ? "gold" : undefined} />
        </div>
        <Card title="مناسباتي القادمة">
          {events.error ? (
            <LoadError />
          ) : (
            <Table head={["المناسبة", "النوع", "التاريخ", "الحالة"]} empty={!events.data?.length}>
              {events.data?.map((e) => (
                <tr key={e.id}>
                  <td><RowLink href={`/admin/events/${e.id}`}>{e.title}</RowLink></td>
                  <td>{eventTypeLabel(e.event_type)}</td>
                  <td>{fmtDate(e.event_date)}</td>
                  <td><Badge>{EVENT_STATUS[e.status]}</Badge></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </>
    );
  }

  const head = { count: "exact" as const, head: true };
  const [newBookings, due, reviews, albums, support, cleanup, summary, upcoming] = await Promise.all([
    sb.from("booking_requests").select("id", head).eq("status", "new"),
    dueQ,
    sb.from("reviews").select("id", head).eq("status", "pending"),
    sb.from("album_selections").select("id", head).eq("status", "submitted"),
    sb.from("support_requests").select("id", head).eq("status", "open"),
    // Read-only queue counts (admin-only RPC, migration 0010). Deletion itself is done by the
    // scheduled storage-cleanup Edge Function; this only surfaces backlog and dead-lettered items.
    sb.rpc("storage_cleanup_pending"),
    sb.rpc("admin_financial_summary", { p_from: "2000-01-01", p_to: today }),
    sb
      .from("deliverables")
      .select("id, title, status, due_at, event_id")
      .not("status", "in", "(approved,delivered)")
      .lte("due_at", in3)
      .order("due_at")
      .limit(8),
  ]);
  const outstanding = summary.data?.[0]?.outstanding ?? 0;

  const alerts = [
    { n: newBookings.count ?? 0, label: "طلبات حجز جديدة", href: "/admin/bookings?status=new" },
    { n: due.count ?? 0, label: "تسليمات خلال ٣ أيام أو متأخرة", href: "/admin/production?due=soon" },
    { n: reviews.count ?? 0, label: "تقييمات بانتظار المراجعة", href: "/admin/reviews?status=pending" },
    { n: albums.count ?? 0, label: "اختيارات ألبوم مُرسلة", href: "/admin/production/albums" },
    { n: support.count ?? 0, label: "طلبات دعم مفتوحة", href: "/admin/support?status=open" },
    { n: cleanup.data?.[0]?.pending ?? 0, label: "ملفات منشورة سابقاً بانتظار الحذف من التخزين", href: "/admin/media?orphans=1" },
    { n: cleanup.data?.[0]?.dead ?? 0, label: "ملفات تعذّر حذفها بعد عدة محاولات", href: "/admin/media?orphans=1" },
  ];
  const active = alerts.filter((a) => a.n > 0);

  return (
    <>
      <PageHeader title="نظرة عامة" lead="ما يحتاج انتباهك الآن فقط." />
      {active.length === 0 && outstanding <= 0 ? (
        <p className="mb-6 rounded-md border border-cream-line bg-[#fffdf8] p-4 text-sm" data-testid="all-clear">
          لا يوجد ما يحتاج متابعة الآن.
        </p>
      ) : null}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="alerts">
        {active.map((a) => (
          <Stat key={a.href} label={a.label} value={a.n} href={a.href} tone="gold" />
        ))}
        {outstanding > 0 ? (
          <Stat label="أرصدة غير مدفوعة على العقود المعتمدة" value={formatMinor(outstanding)} href="/admin/finance" tone="danger" />
        ) : null}
      </div>
      <Card title="تنظيف التخزين" className="mb-6">
        <p className="mb-3 text-sm text-on-cream-muted">
          عند إيقاف نشر مناسبة أو سحب الموافقة أو حذف مناسبة تُوضع ملفاتها في قائمة حذف. يعمل التنظيف تلقائياً بعد إجراءات الإدارة، ويمكن تشغيله هنا (مثلاً بعد سحب العميل لموافقته من البوابة).
        </p>
        <ActionForm action={runStorageCleanup} submitLabel="تشغيل التنظيف الآن" kind="ghost" testId="cleanup-form" />
      </Card>
      {upcoming.data?.length ? (
        <Card title="تسليمات قريبة">
          <ul className="divide-y divide-cream-line text-sm">
            {upcoming.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link className="underline underline-offset-4" href={`/admin/production/${d.id}`}>{d.title}</Link>
                <span className="flex items-center gap-2">
                  <Badge>{DELIVERABLE_STATUS[d.status]}</Badge>
                  <span className={d.due_at && d.due_at < nowIso ? "text-danger" : ""}>{fmtDate(d.due_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
