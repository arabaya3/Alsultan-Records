import Link from "next/link";
import { Suspense } from "react";
import { DeliverableList, EventProgress, PanelSkeleton, Unavailable } from "@/features/portal/components/PortalUi";
import { loadEventPage } from "@/features/portal/event-page";

async function Overview({ params }: { params: Promise<{ eventId: string }> }) {
  const { overview, path, eventId } = await loadEventPage(params);
  if (!overview) return <Unavailable retryHref={path} />;
  const { tabs, deliverables, imageCount } = overview;
  const base = `/portal/events/${eventId}`;
  const cards = [
    tabs.gallery && { href: `${base}/gallery`, title: "المعرض", body: `${imageCount} صورة جاهزة للمشاهدة` },
    tabs.selection && { href: `${base}/selection`, title: "اختيار صور الألبوم", body: "اختر صورك المفضلة وأرسلها لنا" },
    tabs.videos && { href: `${base}/videos`, title: "الأفلام", body: "شاهد النسخ وأضف ملاحظاتك بالتوقيت" },
    tabs.files && { href: `${base}/files`, title: "الملفات", body: "تنزيل الملفات المسلّمة" },
    tabs.quotes && { href: `${base}/quotes`, title: "عروض الأسعار", body: "راجع العرض ووافق عليه" },
    tabs.contracts && { href: `${base}/contracts`, title: "العقود", body: "اقرأ العقد واعتمده" },
    tabs.payments && { href: `${base}/payments`, title: "الدفعات", body: "سجل الدفعات والرصيد" },
  ].filter((c): c is { href: string; title: string; body: string } => Boolean(c));

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
      <section aria-labelledby="sec-h">
        <h2 id="sec-h" className="mb-4 text-2xl font-bold">
          ماذا يمكنك أن تفعل الآن
        </h2>
        {cards.length ? (
          <ul className="grid gap-4 sm:grid-cols-2">
            {cards.map((c) => (
              <li key={c.href}>
                <Link href={c.href} className="block h-full rounded-md border border-cream-line bg-[#fffdf8] p-5 transition-colors hover:border-gold">
                  <span className="font-display text-lg font-semibold">{c.title}</span>
                  <span className="mt-1 block text-sm text-on-cream-muted">{c.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-on-cream-muted">نعمل على مناسبتك. ستظهر الصور والأفلام هنا فور تجهيزها.</p>
        )}
      </section>
      <aside className="rounded-md border border-cream-line bg-cream-2 p-5">
        <h2 className="mb-4 text-lg font-semibold">سير العمل</h2>
        <EventProgress status={overview.event.status} />
        <h3 className="mb-2 mt-6 text-base font-semibold">الأعمال المسلَّمة</h3>
        <DeliverableList items={deliverables} />
      </aside>
    </div>
  );
}

export default function EventOverviewPage({ params }: PageProps<"/portal/events/[eventId]">) {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <Overview params={params} />
    </Suspense>
  );
}
