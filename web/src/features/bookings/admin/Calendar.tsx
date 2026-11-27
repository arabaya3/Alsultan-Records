import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { btn, EmptyState, LoadError, PageHeader } from "@/features/admin/ui";
import { one, type SP } from "@/features/admin/query";
import { todayISO } from "@/features/admin/format";
import { EVENT_STATUS } from "@/features/admin/labels";
import { StatusPill } from "@/features/admin/StatusPill";
import { IconArchive, IconCalendar, IconList, IconPlus, IconTrash } from "@/features/admin/icons";

const WEEKDAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];

function monthParam(v: string): { y: number; m: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(v);
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    if (y > 2000 && y < 2100 && m >= 1 && m <= 12) return { y, m };
  }
  const t = todayISO();
  return { y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) };
}
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const arDigits = (n: number) => n.toLocaleString("ar-EG");

type Item = { id: string; title: string; href: string; kind: "event" | "booking"; status?: string };

/**
 * «التقويم والمناسبات»: the month on one side, the chosen day's events beside it (a link per day keeps it in the URL:
 * ?month=YYYY-MM&day=D). Same reads as before (events + confirmed bookings not converted yet); one «مناسبة جديدة».
 */
export async function CalendarView({ searchParams }: { searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sp = await searchParams;
  const { y, m } = monthParam(one(sp.month));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = `${ym(y, m)}-01`;
  const last = `${ym(y, m)}-${String(daysInMonth).padStart(2, "0")}`;
  const sb = await createClient();
  const [events, bookings, totals] = await Promise.all([
    sb.from("events").select("id, title, event_date, status").gte("event_date", first).lte("event_date", last).order("event_date").limit(500),
    sb
      .from("booking_requests")
      .select("id, contact_name, event_date")
      .eq("status", "confirmed")
      .gte("event_date", first)
      .lte("event_date", last)
      .limit(500),
    sb.from("events").select("id", { count: "exact", head: true }).is("deleted_at", null),
  ]);
  if (events.error || bookings.error) return <LoadError what="التقويم" />;

  // Confirmed bookings already converted to an event are shown once (as the event).
  const converted = new Set<string>();
  const evIds = (events.data ?? []).map((e) => e.id);
  if (evIds.length) {
    const r = await sb.from("events").select("booking_request_id").in("id", evIds).not("booking_request_id", "is", null);
    for (const e of r.data ?? []) if (e.booking_request_id) converted.add(e.booking_request_id);
  }
  const byDay = new Map<number, Item[]>();
  const add = (date: string | null, it: Item) => {
    if (!date) return;
    const d = Number(date.slice(8, 10));
    byDay.set(d, [...(byDay.get(d) ?? []), it]);
  };
  for (const e of events.data ?? []) add(e.event_date, { id: e.id, title: e.title, href: `/admin/events/${e.id}`, kind: "event", status: e.status });
  for (const b of bookings.data ?? [])
    if (!converted.has(b.id)) add(b.event_date, { id: b.id, title: b.contact_name, href: `/admin/bookings/${b.id}`, kind: "booking" });

  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const prev = m === 1 ? ym(y - 1, 12) : ym(y, m - 1);
  const next = m === 12 ? ym(y + 1, 1) : ym(y, m + 1);
  const today = todayISO();
  const todayInMonth = today.slice(0, 7) === ym(y, m) ? Number(today.slice(8, 10)) : null;
  const dayRaw = Number(one(sp.day));
  const day = dayRaw >= 1 && dayRaw <= daysInMonth ? dayRaw : (todayInMonth ?? 1);
  const dayItems = byDay.get(day) ?? [];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
  const dayHref = (d: number) => `/admin/calendar?month=${ym(y, m)}&day=${d}`;

  return (
    <>
      <PageHeader
        title="التقويم والمناسبات"
        actions={
          <Link className={btn("primary", "px-6 text-base")} href="/admin/events/new">
            <IconPlus /> مناسبة جديدة
          </Link>
        }
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-5 text-base">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-gold" /> مناسبة
          </span>
          <span className="inline-flex items-center gap-2 text-on-cream-muted">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-on-cream-muted/50" /> حجز مؤكد لم يتحوّل بعد
          </span>
        </p>
        <nav aria-label="الانتقال بين الشهور" className="flex flex-wrap gap-2">
          <Link className={btn("ghost", "px-5")} href={`/admin/calendar?month=${prev}`}>
            <span aria-hidden="true">›</span> الشهر السابق
          </Link>
          <Link className={btn("ghost", "px-6")} href="/admin/calendar">
            اليوم
          </Link>
          <Link className={btn("ghost", "px-5")} href={`/admin/calendar?month=${next}`}>
            الشهر التالي <span aria-hidden="true">‹</span>
          </Link>
        </nav>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,1fr)]">
        {/* Month */}
        <section aria-labelledby="cal-month" className="rounded-2xl border border-cream-line bg-[#fffdf8] p-3 shadow-[0_8px_24px_-20px_rgb(60_45_20/0.4)] md:p-4">
          <h2 id="cal-month" className="py-3 text-center font-display text-2xl font-bold md:text-3xl">
            {MONTHS[m - 1]} {y}
          </h2>
          <div className="grid grid-cols-7 overflow-hidden rounded-t-lg bg-cream-2 text-center text-xs font-semibold text-on-cream sm:text-sm">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-1 py-2.5">
                <span className="hidden sm:inline">{d}</span>
                <span className="sm:hidden" aria-label={d}>{d.replace(/^ال/, "").slice(0, 2)}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 border-s border-cream-line" data-testid="calendar-grid">
            {cells.map((d, i) => {
              if (!d) return <div key={i} aria-hidden="true" className="min-h-14 border-e border-b border-cream-line bg-cream-2/60 sm:min-h-20" />;
              const items = byDay.get(d) ?? [];
              const isToday = d === todayInMonth;
              const isSel = d === day;
              return (
                <Link
                  key={i}
                  href={dayHref(d)}
                  scroll={false}
                  aria-current={isSel ? "date" : undefined}
                  aria-label={`${d} ${MONTHS[m - 1]}${items.length ? `، ${items.length} مناسبة` : ""}`}
                  data-testid="calendar-day"
                  data-day={d}
                  className={`relative flex min-h-14 flex-col items-end gap-1 border-e border-b border-cream-line p-1.5 transition-colors hover:bg-gold/10 sm:min-h-20 sm:p-2 ${isSel ? "bg-gold/10" : ""}`}
                >
                  <span
                    className={`inline-grid size-8 place-items-center rounded-full text-sm font-semibold sm:size-9 sm:text-base ${
                      isToday ? "bg-gold text-ink" : isSel ? "ring-2 ring-gold" : "text-on-cream"
                    }`}
                  >
                    {d}
                  </span>
                  {items.length ? (
                    <span className="flex flex-wrap justify-end gap-1" aria-hidden="true">
                      {items.slice(0, 3).map((it) => (
                        <span key={it.kind + it.id} className={`size-2 rounded-full ${it.kind === "event" ? "bg-gold" : "bg-on-cream-muted/50"}`} />
                      ))}
                    </span>
                  ) : null}
                  {items[0] ? (
                    <span className="hidden w-full truncate text-start text-xs text-on-cream-muted lg:block">{items[0].title}</span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </section>

        {/* Chosen day */}
        <section aria-labelledby="cal-day" className="flex flex-col overflow-hidden rounded-2xl border border-cream-line bg-[#fffdf8] shadow-[0_8px_24px_-20px_rgb(60_45_20/0.4)]" data-testid="calendar-day-panel">
          <h2 id="cal-day" className="flex items-center gap-3 border-b border-cream-line bg-cream-2/70 px-5 py-4 font-display text-xl font-bold md:text-2xl">
            <span className="text-gold-press"><IconCalendar size={28} /></span>
            {weekday} {arDigits(day)} {MONTHS[m - 1]}
          </h2>
          <div className="flex-1">
            {dayItems.length ? (
              <ul className="divide-y divide-cream-line">
                {dayItems.map((it) => (
                  <li key={it.kind + it.id} className="flex items-center gap-3 px-5 py-3">
                    <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${it.kind === "event" ? "bg-gold" : "bg-on-cream-muted/50"}`} />
                    <Link href={it.href} className="min-w-0 flex-1 font-medium break-words underline-offset-4 hover:underline">
                      {it.kind === "booking" ? "حجز: " : ""}
                      {it.title}
                    </Link>
                    {it.status ? <StatusPill label={EVENT_STATUS[it.status as keyof typeof EVENT_STATUS] ?? it.status} tone={it.status === "delivered" ? "success" : "neutral"} /> : <StatusPill label="حجز مؤكد" tone="gold" />}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<IconCalendar size={44} />} title="ما في مناسبات بهذا اليوم" body="يمكنك إضافة مناسبة جديدة من الزر العلوي ( + مناسبة جديدة )." />
            )}
          </div>
          <div className="mx-4 flex flex-wrap items-center gap-2 border-t border-cream-line py-4 text-sm">
            <Link href="/admin/events" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-gold/15 px-4 font-semibold hover:bg-gold/25">
              <span className="text-gold-press"><IconList /></span> كل المناسبات ({(totals.count ?? 0).toLocaleString("en-US")})
            </Link>
            <span className="ms-auto flex items-center">
              <Link href="/admin/events?status=archived" className="inline-flex min-h-11 items-center gap-2 px-3 hover:underline">
                <IconArchive /> الأرشيف
              </Link>
              <span aria-hidden="true" className="h-6 w-px bg-cream-line" />
              <Link href="/admin/events?view=trash" className="inline-flex min-h-11 items-center gap-2 px-3 hover:underline">
                <IconTrash /> المحذوفات
              </Link>
            </span>
          </div>
        </section>
      </div>
    </>
  );
}
