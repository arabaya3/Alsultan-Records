import Link from "next/link";

/** Round icon-only link (label kept for screen readers + hover tooltip). Replaces underlined text links in section headers/cards. */
export const iconLinkCls =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-hairline text-ivory transition-colors duration-200 hover:border-gold hover:text-gold focus-visible:border-gold";

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
export const GridIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width={18} height={18} {...P}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </svg>
);
/** Forward arrow for this RTL site (points left). */
export const ArrowStartIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width={18} height={18} {...P}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);

export function IconLink({ href, label, external, children, className = "", ...rest }: { href: string; label: string; external?: boolean; children: React.ReactNode; className?: string } & Record<`data-${string}`, unknown>) {
  const cls = `${iconLinkCls} ${className}`;
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className={cls} {...rest}>{children}</a>
  ) : (
    <Link href={href} aria-label={label} title={label} className={cls} {...rest}>{children}</Link>
  );
}
