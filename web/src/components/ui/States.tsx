import type { ReactNode } from "react";

/** Nothing published yet — a normal, calm state. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div role="status" className="rounded-md border border-dashed border-cream-line px-6 py-12 text-center">
      <p className="font-display text-xl font-semibold">{title}</p>
      {body ? <p className="mx-auto mt-2 max-w-md text-on-cream-muted">{body}</p> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** The service could not be reached — different from "empty". */
export function ErrorState({
  title = "تعذّر تحميل المحتوى الآن",
  body = "حدث خلل مؤقت أثناء جلب البيانات. حاول مرة أخرى بعد قليل، أو تواصل معنا مباشرة.",
  action,
}: {
  title?: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-6 py-10 text-center">
      <p className="font-display text-xl font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-on-cream-muted">{body}</p>
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-sm bg-cream-line/70 ${className}`} />;
}

export function TileGridSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="grid gap-6 md:grid-cols-2" role="status" aria-busy="true" aria-label="جارِ التحميل">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="aspect-[4/3] md:aspect-[16/7]" />
      ))}
    </div>
  );
}
