import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { btn, LoadError, PageHeader } from "@/features/admin/ui";
import { one, type SP } from "@/features/admin/query";
import { todayISO } from "@/features/admin/format";

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

type Item = { id: string; title: string; href: string; kind: "event" | "booking" };

export async function CalendarView({ searchParams }: { searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sp = await searchParams;
  const { y, m } = monthParam(one(sp.month));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = `${ym(y, m)}-01`;
  const last = `${ym(y, m)}-${String(daysInMonth).padStart(2, "0")}`;
  const sb = await createClient();
  const [events, bookings] = await Promise.all([
    sb.from("events").select("id, title, event_date").gte("event_date", first).lte("event_date", last).order("event_date").limit(500),
    sb
      .from("booking_requests")
      .select("id, contact_name, event_date")
      .eq("status", "confirmed")
      .gte("event_date", first)
      .lte("event_date", last)
      .limit(500),
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
  for (const e of events.data ?? []) add(e.event_date, { id: e.id, title: e.title, href: `/admin/events/${e.id}`, kind: "event" });
  for (const b of bookings.data ?? [])
    if (!converted.has(b.id)) add(b.event_date, { id: b.id, title: b.contact_name, href: `/admin/bookings/${b.id}`, kind: "booking" });

  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const prev = m === 1 ? ym(y - 1, 12) : ym(y, m - 1);
  const next = m === 12 ? ym(y + 1, 1) : ym(y, m + 1);
  const today = todayISO();

  return (
    <>
      <PageHeader
        title={`التقويم · ${MONTHS[m - 1]} ${y}`}
        lead={
          <span className="flex flex-wrap gap-3">
            <span><span className="inline-block size-2 rounded-full bg-ink" /> مناسبة</span>
            <span><span className="inline-block size-2 rounded-full bg-gold" /> حجز مؤكد لم يُحوّل بعد</span>
          </span>
        }
        actions={
          <>
            <Link className={btn("ghost")} href={`/admin/calendar?month=${prev}`}>الشهر السابق</Link>
            <Link className={btn("ghost")} href="/admin/calendar">اليوم</Link>
            <Link className={btn("ghost")} href={`/admin/calendar?month=${next}`}>الشهر التالي</Link>
          </>
        }
      />
      {/* Desktop grid */}
      <div className="hidden overflow-hidden rounded-md border border-cream-line bg-[#fffdf8] md:block">
        <div className="grid grid-cols-7 border-b border-cream-line bg-cream-2 text-xs text-on-cream-muted">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-1.5">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const iso = d ? `${ym(y, m)}-${String(d).padStart(2, "0")}` : "";
            return (
              <div key={i} className={`min-h-24 border-b border-e border-cream-line p-1.5 text-xs ${d ? "" : "bg-cream-2/50"}`}>
                {d ? (
                  <>
                    <span className={`inline-grid size-6 place-items-center rounded-full ${iso === today ? "bg-gold font-bold text-ink" : "text-on-cream-muted"}`}>{d}</span>
                    <ul className="mt-1 space-y-1">
                      {byDay.get(d)?.map((it) => (
                        <li key={it.kind + it.id}>
                          <Link
                            href={it.href}
                            className={`block truncate rounded-sm px-1.5 py-0.5 ${it.kind === "event" ? "bg-ink text-on-dark" : "bg-gold/30"}`}
                            title={it.title}
                          >
                            {it.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {/* Mobile agenda */}
      <ul className="space-y-2 md:hidden">
        {[...byDay.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([d, items]) => (
            <li key={d} className="rounded-md border border-cream-line bg-[#fffdf8] p-3">
              <p className="mb-1 text-xs text-on-cream-muted">{`${d} ${MONTHS[m - 1]}`}</p>
              {items.map((it) => (
                <Link key={it.kind + it.id} href={it.href} className="block py-0.5 text-sm underline underline-offset-4">
                  {it.kind === "booking" ? "حجز: " : ""}
                  {it.title}
                </Link>
              ))}
            </li>
          ))}
        {byDay.size === 0 ? <li className="text-sm text-on-cream-muted">لا شيء في هذا الشهر.</li> : null}
      </ul>
    </>
  );
}
