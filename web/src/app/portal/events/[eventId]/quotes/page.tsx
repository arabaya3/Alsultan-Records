import type { Metadata } from "next";
import { Suspense } from "react";
import { EmptyState } from "@/components/ui/States";
import { acceptQuote } from "@/features/portal/actions";
import { listQuotes } from "@/features/portal/commercial";
import { ConfirmAction } from "@/features/portal/components/ConfirmAction";
import { PanelSkeleton, StatusPill, Unavailable } from "@/features/portal/components/PortalUi";
import { loadEventPage } from "@/features/portal/event-page";
import { dateAr, money, QUOTE_STATUS } from "@/features/portal/format";

export const metadata: Metadata = { title: "عروض الأسعار" };

async function Quotes({ params }: { params: Promise<{ eventId: string }> }) {
  const { supabase, eventId, path, overview } = await loadEventPage(params, "quotes");
  const quotes = overview ? await listQuotes(supabase, eventId) : null;
  if (!quotes) return <Unavailable retryHref={path} />;
  if (!quotes.length) return <EmptyState title="لا توجد عروض أسعار بعد" />;
  return (
    <ul className="grid gap-6">
      {quotes.map((q) => (
        <li key={q.id} className="rounded-md border border-cream-line bg-[#fffdf8] p-5 md:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">
              عرض سعر <span dir="ltr">{q.quote_no}</span>
            </h2>
            <StatusPill status={q.status === "sent" ? "review" : q.status === "accepted" ? "approved" : "in_progress"} label={QUOTE_STATUS[q.status]} />
          </div>
          <table className="w-full text-sm">
            <thead className="text-on-cream-muted">
              <tr>
                <th className="py-2 text-start font-medium">البند</th>
                <th className="py-2 text-start font-medium">الكمية</th>
                <th className="py-2 text-end font-medium">المبلغ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-line">
              {q.quote_items.map((it) => (
                <tr key={it.id}>
                  <td className="py-2">{it.description}</td>
                  <td className="py-2">{Number(it.qty)}</td>
                  <td className="py-2 text-end">{money(it.line_total, q.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {q.discount ? (
                <tr>
                  <td colSpan={2} className="pt-3">خصم</td>
                  <td className="pt-3 text-end">− {money(q.discount, q.currency)}</td>
                </tr>
              ) : null}
              <tr className="font-semibold">
                <td colSpan={2} className="pt-2">الإجمالي</td>
                <td className="pt-2 text-end">{money(q.total, q.currency)}</td>
              </tr>
            </tfoot>
          </table>
          <div className="mt-5">
            {q.status === "sent" ? (
              <>
                {q.valid_until ? <p className="mb-3 text-sm text-on-cream-muted">صالح حتى {dateAr(q.valid_until)}</p> : null}
                <ConfirmAction
                  label="الموافقة على العرض"
                  confirmText={`توافق على العرض بقيمة ${money(q.total, q.currency)}؟`}
                  doneText="تمت الموافقة على العرض. شكراً لك!"
                  run={acceptQuote.bind(null, q.id)}
                />
              </>
            ) : q.status === "accepted" && q.accepted_at ? (
              <p className="text-success">وافقت على هذا العرض في {dateAr(q.accepted_at)}.</p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function QuotesPage({ params }: PageProps<"/portal/events/[eventId]/quotes">) {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <Quotes params={params} />
    </Suspense>
  );
}
