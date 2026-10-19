import { ButtonLink } from "@/components/ui/Button";
import { ErrorState, Skeleton } from "@/components/ui/States";
import { DELIVERABLE_KIND, DELIVERABLE_STATUS, EVENT_STATUS, EVENT_STEPS } from "@/features/portal/format";
import type { DeliverableSummary } from "@/features/portal/queries";

export function EventProgress({ status }: { status: string }) {
  const idx = EVENT_STEPS.indexOf(status as (typeof EVENT_STEPS)[number]);
  const at = status === "archived" ? EVENT_STEPS.length - 1 : idx;
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label={`مرحلة المناسبة: ${EVENT_STATUS[status] ?? status}`}>
      {EVENT_STEPS.map((s, i) => (
        <li key={s} className="min-w-0">
          <span aria-hidden="true" className={`block h-1 rounded-full ${i <= at ? "bg-gold" : "bg-cream-line"}`} />
          <span className={`mt-1.5 block truncate text-xs ${i === at ? "font-semibold text-on-cream" : "text-on-cream-muted"}`}>
            {EVENT_STATUS[s]}
            {i === at ? <span className="sr-only"> (المرحلة الحالية)</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

const STATUS_TONE: Record<string, string> = {
  review: "bg-gold/25 text-on-cream",
  revision_requested: "bg-danger/10 text-danger",
  approved: "bg-success/10 text-success",
  delivered: "bg-success/10 text-success",
  in_progress: "bg-cream-2 text-on-cream-muted",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-block rounded-sm px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status] ?? "bg-cream-2"}`}>
      {label ?? DELIVERABLE_STATUS[status] ?? status}
    </span>
  );
}

export function DeliverableList({ items }: { items: DeliverableSummary[] }) {
  if (!items.length) return <p className="text-sm text-on-cream-muted">لم تبدأ تجهيز الأعمال بعد.</p>;
  return (
    <ul className="divide-y divide-cream-line">
      {items.map((d) => (
        <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <span className="min-w-0 truncate">
            <span className="text-on-cream-muted">{DELIVERABLE_KIND[d.kind] ?? ""} · </span>
            {d.title}
          </span>
          <StatusPill status={d.status} />
        </li>
      ))}
    </ul>
  );
}

export function PanelSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="جارِ التحميل" className="grid gap-4">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function Unavailable({ retryHref }: { retryHref: string }) {
  return <ErrorState action={<ButtonLink href={retryHref}>إعادة المحاولة</ButtonLink>} />;
}
