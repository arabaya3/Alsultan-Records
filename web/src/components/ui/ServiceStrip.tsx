import { CORE_SERVICES } from "@/features/public-content/site";

/** "تصوير فوتوغرافي • أفلام أعراس • DJ" with gold dot separators. */
export function ServiceStrip({
  items = CORE_SERVICES,
  className = "",
}: {
  items?: readonly string[];
  className?: string;
}) {
  return (
    <ul className={`flex flex-wrap items-center gap-x-5 gap-y-2 text-base md:text-lg ${className}`}>
      {items.map((item, i) => (
        <li key={item} className="flex items-center gap-5">
          {i > 0 ? <span aria-hidden="true" className="size-1.5 rounded-full bg-gold" /> : null}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
