import Link from "next/link";
import { Suspense } from "react";
import { Container } from "@/components/ui/Layout";
import { EmptyState, Skeleton } from "@/components/ui/States";
import { eventTypeLabel } from "@/features/public-content/labels";
import { dateAr, EVENT_STATUS } from "@/features/portal/format";
import { DeliverableList, EventProgress, Unavailable } from "@/features/portal/components/PortalUi";
import { listMyEvents } from "@/features/portal/queries";

async function Events() {
  const res = await listMyEvents();
  if (res.status === "unavailable") return <Unavailable retryHref="/portal" />;
  if (!res.data.length)
    return (
      <EmptyState
        title="لا توجد مناسبات مرتبطة بحسابك بعد"
        body="عند تأكيد حجزك سيضيف الاستوديو مناسبتك هنا، لتتابع التصوير والتسليم خطوة بخطوة."
      />
    );
  return (
    <ul className="grid gap-6 md:grid-cols-2" data-testid="event-list">
      {res.data.map((e) => {
        const awaiting = e.deliverables.filter((d) => d.status === "review").length;
        return (
          <li key={e.id} className="flex flex-col rounded-md border border-cream-line bg-[#fffdf8] p-6" data-testid="event-card">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-on-cream-muted">
                  {[eventTypeLabel(e.event_type), dateAr(e.event_date), e.city].filter(Boolean).join(" · ")}
                </p>
                <h2 className="mt-1 text-2xl font-bold">{e.title}</h2>
              </div>
              <span className="shrink-0 rounded-sm bg-ink px-2.5 py-1 text-xs text-on-dark">{EVENT_STATUS[e.status] ?? e.status}</span>
            </div>
            <EventProgress status={e.status} />
            <div className="mt-5 flex-1">
              <DeliverableList items={e.deliverables} />
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              {awaiting ? <p className="text-sm font-medium">{awaiting} بانتظار مراجعتك</p> : <span />}
              <Link
                href={`/portal/events/${e.id}`}
                className="inline-flex min-h-11 items-center rounded-sm bg-gold px-5 font-medium text-ink hover:bg-gold-press"
              >
                فتح المناسبة
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function PortalHome() {
  return (
    <Container className="py-10 md:py-14">
      <h1 className="mb-8 text-3xl font-bold md:text-4xl">
        مناسباتي<span className="text-gold">.</span>
      </h1>
      <Suspense
        fallback={
          <div className="grid gap-6 md:grid-cols-2" aria-busy="true" aria-label="جارِ التحميل">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        }
      >
        <Events />
      </Suspense>
    </Container>
  );
}
