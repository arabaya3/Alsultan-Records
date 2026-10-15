import Link from "next/link";
import type { ReactNode } from "react";

/** Admin UI primitives: calm, dense, ink/cream/gold. Server-safe (no hooks). */

export function PageHeader({
  title,
  lead,
  actions,
  back,
}: {
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-cream-line pb-4">
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mb-1 inline-block text-sm text-on-cream-muted hover:text-on-cream">
            → {back.label}
          </Link>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight md:text-[1.75rem]">{title}</h1>
        {lead ? <div className="mt-1 text-sm text-on-cream-muted">{lead}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  children,
  actions,
  className = "",
  id,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`rounded-md border border-cream-line bg-[#fffdf8] ${className}`}>
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cream-line px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          {actions}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

const TONES = {
  neutral: "bg-cream-2 text-on-cream border-cream-line",
  gold: "bg-gold/20 text-on-cream border-gold/60",
  success: "bg-success/10 text-success border-success/40",
  danger: "bg-danger/10 text-danger border-danger/40",
  ink: "bg-ink text-on-dark border-ink",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-md border border-cream-line bg-[#fffdf8]">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-cream-line bg-cream-2 text-start text-xs text-on-cream-muted">
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 text-start font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-cream-line [&>tr:last-child]:border-0 [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top">
          {children}
        </tbody>
      </table>
      {empty ? <p className="px-4 py-8 text-center text-on-cream-muted">لا توجد سجلات مطابقة.</p> : null}
    </div>
  );
}

export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium underline decoration-cream-line underline-offset-4 hover:decoration-gold">
      {children}
    </Link>
  );
}

function buildHref(base: string, params: Record<string, string>, patch: Record<string, string | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export function Pagination({
  base,
  page,
  total,
  size,
  params,
  param = "page",
}: {
  base: string;
  page: number;
  total: number;
  size: number;
  params: Record<string, string>;
  param?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return <p className="mt-3 text-xs text-on-cream-muted">{total} سجل</p>;
  return (
    <nav aria-label="الصفحات" className="mt-3 flex items-center justify-between gap-3 text-sm">
      <span className="text-on-cream-muted">
        صفحة {page} من {pages} · {total} سجل
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link className={btn("ghost")} href={buildHref(base, params, { [param]: String(page - 1) })}>
            السابق
          </Link>
        ) : null}
        {page < pages ? (
          <Link className={btn("ghost")} href={buildHref(base, params, { [param]: String(page + 1) })}>
            التالي
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

/** Status filter chips driven by URL params. */
export function FilterChips({
  base,
  param,
  current,
  options,
  params,
}: {
  base: string;
  param: string;
  current: string;
  options: { value: string; label: string }[];
  params: Record<string, string>;
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="تصفية">
      {[{ value: "", label: "الكل" }, ...options].map((o) => {
        const active = current === o.value;
        return (
          <Link
            key={o.value || "all"}
            href={buildHref(base, params, { [param]: o.value || null, page: null })}
            aria-current={active ? "true" : undefined}
            className={`rounded-sm border px-3 py-1 text-sm ${
              active ? "border-ink bg-ink text-on-dark" : "border-cream-line bg-[#fffdf8] hover:border-on-cream-muted"
            }`}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

/** GET search form; keeps other params as hidden inputs. */
export function SearchBox({
  base,
  q,
  params,
  placeholder = "بحث بالاسم أو الهاتف",
}: {
  base: string;
  q: string;
  params: Record<string, string>;
  placeholder?: string;
}) {
  return (
    <form action={base} method="get" role="search" className="mb-3 flex max-w-xl gap-2">
      {Object.entries(params)
        .filter(([k, v]) => k !== "q" && k !== "page" && v)
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <label className="sr-only" htmlFor="admin-q">
        بحث
      </label>
      <input id="admin-q" name="q" defaultValue={q} placeholder={placeholder} className="field !min-h-10 flex-1" />
      <button type="submit" className={btn("secondary")}>
        بحث
      </button>
    </form>
  );
}

export function btn(kind: "primary" | "secondary" | "ghost" | "danger" = "secondary", extra = "") {
  const base =
    "inline-flex min-h-10 items-center justify-center gap-2 rounded-sm px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const k =
    kind === "primary"
      ? "bg-gold text-ink hover:bg-gold-press"
      : kind === "danger"
        ? "border border-danger/50 text-danger hover:bg-danger/10"
        : kind === "ghost"
          ? "border border-cream-line bg-[#fffdf8] hover:border-on-cream-muted"
          : "bg-ink text-on-dark hover:bg-ink-2";
  return `${base} ${k} ${extra}`;
}

export function Field({
  label,
  children,
  hint,
  className = "",
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-on-cream-muted">{hint}</span> : null}
    </label>
  );
}

export const inputCls = "field !min-h-10 !py-1.5 text-sm";

export function Stat({ label, value, href, tone }: { label: string; value: ReactNode; href?: string; tone?: Tone }) {
  const inner = (
    <div
      className={`h-full rounded-md border bg-[#fffdf8] p-4 ${tone === "gold" ? "border-gold" : tone === "danger" ? "border-danger/50" : "border-cream-line"}`}
    >
      <p className="text-xs text-on-cream-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-90">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function DL({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-on-cream-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`rounded-md border px-4 py-3 text-sm ${TONES[tone]}`}>{children}</div>;
}

export function LoadError({ what = "البيانات" }: { what?: string }) {
  return (
    <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-4 py-6 text-sm">
      تعذّر تحميل {what} الآن. حدّث الصفحة بعد قليل.
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="جارِ التحميل" className="space-y-4">
      <div className="h-8 w-48 animate-pulse rounded-sm bg-cream-line/70" />
      <div className="h-40 animate-pulse rounded-md bg-cream-line/50" />
      <div className="h-64 animate-pulse rounded-md bg-cream-line/40" />
    </div>
  );
}
