import Link from "next/link";
import { Suspense } from "react";
import { Container } from "@/components/ui/Layout";
import { Skeleton } from "@/components/ui/States";
import { eventTypeLabel } from "@/features/public-content/labels";
import { EventTabs } from "@/features/portal/components/EventTabs";
import { loadEventPage } from "@/features/portal/event-page";
import { dateAr, EVENT_STATUS } from "@/features/portal/format";

async function EventHeader({ params }: { params: Promise<{ eventId: string }> }) {
  const { overview, eventId } = await loadEventPage(params);
  if (!overview) return <div className="h-24" />;
  const e = overview.event;
  return (
    <>
      <p className="text-sm text-muted">
        <Link href="/portal" className="hover:text-gold">
          مناسباتي
        </Link>{" "}
        / {eventTypeLabel(e.event_type) ?? "مناسبة"}
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-bold md:text-4xl" data-testid="event-title">
          {e.title}
          <span className="text-gold">.</span>
        </h1>
        <p className="text-muted">
          {[dateAr(e.event_date), e.venue, e.city].filter(Boolean).join(" · ")} ·{" "}
          <span className="text-on-dark">{EVENT_STATUS[e.status] ?? e.status}</span>
        </p>
      </div>
      <div className="mt-6">
        <EventTabs eventId={eventId} tabs={overview.tabs} />
      </div>
    </>
  );
}

export default function EventLayout({ children, params }: LayoutProps<"/portal/events/[eventId]">) {
  return (
    <>
      <div className="bg-ink text-on-dark">
        <Container className="pt-8">
          <Suspense
            fallback={
              <div aria-busy="true" className="pb-4">
                <Skeleton className="h-4 w-32 !bg-ink-line" />
                <Skeleton className="mt-3 h-10 w-2/3 !bg-ink-line" />
                <Skeleton className="mt-6 h-12 w-full !bg-ink-line" />
              </div>
            }
          >
            <EventHeader params={params} />
          </Suspense>
        </Container>
      </div>
      <Container className="py-8 md:py-10">{children}</Container>
    </>
  );
}
