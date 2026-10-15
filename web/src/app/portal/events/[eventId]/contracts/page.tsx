import type { Metadata } from "next";
import { Suspense } from "react";
import { EmptyState } from "@/components/ui/States";
import { approveContract } from "@/features/portal/actions";
import { listContracts } from "@/features/portal/commercial";
import { ConfirmAction } from "@/features/portal/components/ConfirmAction";
import { PanelSkeleton, StatusPill, Unavailable } from "@/features/portal/components/PortalUi";
import { loadEventPage } from "@/features/portal/event-page";
import { CONTRACT_STATUS, dateAr, money } from "@/features/portal/format";

export const metadata: Metadata = { title: "العقود" };

async function Contracts({ params }: { params: Promise<{ eventId: string }> }) {
  const { supabase, eventId, path, overview } = await loadEventPage(params, "contracts");
  const contracts = overview ? await listContracts(supabase, eventId) : null;
  if (!contracts) return <Unavailable retryHref={path} />;
  if (!contracts.length) return <EmptyState title="لا توجد عقود بعد" />;
  return (
    <ul className="grid gap-6">
      {contracts.map((c) => {
        const v = c.version;
        return (
          <li key={c.id} className="rounded-md border border-cream-line bg-[#fffdf8] p-5 md:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold">العقد{v ? ` — النسخة ${v.version_no}` : ""}</h2>
              <StatusPill status={c.status === "approved" ? "approved" : c.status === "sent" ? "review" : "in_progress"} label={CONTRACT_STATUS[c.status]} />
            </div>
            {v ? (
              <>
                <div className="prose-ar max-h-[28rem] overflow-y-auto whitespace-pre-line rounded-sm border border-cream-line bg-cream p-4 leading-8" tabIndex={0} aria-label="نص العقد">
                  {v.body}
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:max-w-md">
                  <dt className="text-on-cream-muted">المبلغ الإجمالي</dt>
                  <dd className="font-semibold">{money(v.total, v.currency)}</dd>
                  <dt className="text-on-cream-muted">العربون المطلوب</dt>
                  <dd className="font-semibold">{money(v.deposit_required, v.currency)}</dd>
                </dl>
                <div className="mt-5">
                  {c.status === "sent" ? (
                    <ConfirmAction
                      label="اعتماد العقد"
                      confirmText="أقرّ بأنني قرأت نص العقد أعلاه وأوافق عليه."
                      doneText="تم اعتماد العقد. شكراً لك!"
                      run={approveContract.bind(null, v.id, v.content_hash)}
                    />
                  ) : c.status === "approved" && c.approved_version_id === v.id ? (
                    <p className="text-success">اعتمدت هذه النسخة في {dateAr(c.approved_at)}.</p>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="text-on-cream-muted">نص العقد قيد التجهيز.</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function ContractsPage({ params }: PageProps<"/portal/events/[eventId]/contracts">) {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <Contracts params={params} />
    </Suspense>
  );
}
