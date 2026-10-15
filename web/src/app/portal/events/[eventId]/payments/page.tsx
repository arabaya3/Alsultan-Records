import type { Metadata } from "next";
import { Suspense } from "react";
import { getPayments } from "@/features/portal/commercial";
import { PanelSkeleton, Unavailable } from "@/features/portal/components/PortalUi";
import { loadEventPage } from "@/features/portal/event-page";
import { dateAr, money } from "@/features/portal/format";

export const metadata: Metadata = { title: "الدفعات" };

async function Payments({ params }: { params: Promise<{ eventId: string }> }) {
  const { supabase, eventId, path, overview } = await loadEventPage(params, "payments");
  const res = overview ? await getPayments(supabase, eventId) : null;
  if (!res) return <Unavailable retryHref={path} />;
  const t = res.totals;
  const cur = t?.currency ?? "ILS";
  return (
    <div className="grid gap-8">
      {/* Totals are computed by the event_financials RPC only — never summed on the client. */}
      <dl className="grid gap-4 sm:grid-cols-4" data-testid="financials">
        {[
          ["قيمة العقد", t?.contracted],
          ["المدفوع", t?.paid],
          ["المُسترد", t?.refunded],
          ["المتبقّي", t?.balance],
        ].map(([label, v]) => (
          <div key={label as string} className="rounded-md border border-cream-line bg-[#fffdf8] p-4">
            <dt className="text-sm text-on-cream-muted">{label}</dt>
            <dd className="mt-1 font-display text-xl font-semibold">{money(v as number | undefined, cur)}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="p-h">
        <h2 id="p-h" className="mb-4 text-2xl font-bold">سجل الدفعات</h2>
        {res.payments.length ? (
          <ul className="divide-y divide-cream-line rounded-md border border-cream-line bg-[#fffdf8]">
            {res.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{p.kind === "refund" ? "استرداد" : "دفعة"} · {p.method}</p>
                  <p className="text-sm text-on-cream-muted">{dateAr(p.received_at)}{p.reference ? ` · ${p.reference}` : ""}</p>
                </div>
                <p className={`font-semibold ${p.kind === "refund" ? "text-danger" : ""}`}>
                  {p.kind === "refund" ? "− " : ""}
                  {money(p.amount, p.currency)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-on-cream-muted">لم تُسجَّل أي دفعات بعد.</p>
        )}
      </section>
    </div>
  );
}

export default function PaymentsPage({ params }: PageProps<"/portal/events/[eventId]/payments">) {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <Payments params={params} />
    </Suspense>
  );
}
