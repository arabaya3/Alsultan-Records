import Link from "next/link";
import { bookingHref } from "@/features/public-content/contact";
import { getBusinessSettings } from "@/features/public-content/queries";
import { WhatsAppIcon } from "./WhatsAppIcon";

export { WhatsAppIcon };

const PRIMARY =
  "inline-flex items-center justify-center gap-3 rounded-sm bg-gold font-medium text-ink transition-colors duration-200 hover:bg-gold-press active:bg-gold-press";

/** A WhatsApp anchor styled as the gold primary action. Pass an already-built href. */
export function WhatsAppLink({
  href,
  children = "احجز عبر واتساب",
  size = "md",
  className = "",
}: {
  href: string;
  children?: React.ReactNode;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-whatsapp-cta
      className={`${PRIMARY} ${size === "lg" ? "min-h-14 px-7 text-lg" : "min-h-11 px-6 text-base"} ${className}`}
    >
      <WhatsAppIcon size={size === "lg" ? 22 : 20} />
      <span>{children}</span>
    </a>
  );
}

/** Booking CTA from business_settings; if no WhatsApp is configured, falls back to /contact. */
export async function WhatsAppCta({
  text,
  label = "احجز عبر واتساب",
  size = "md",
  className = "",
}: {
  text?: string;
  label?: string;
  size?: "md" | "lg";
  className?: string;
}) {
  const settings = await getBusinessSettings();
  const href = bookingHref(settings.status === "ok" ? settings.data : null, text);
  if (!href) {
    return (
      <Link href="/contact" className={`${PRIMARY} ${size === "lg" ? "min-h-14 px-7 text-lg" : "min-h-11 px-6"} ${className}`}>
        تواصل معنا
      </Link>
    );
  }
  return (
    <WhatsAppLink href={href} size={size} className={className}>
      {label}
    </WhatsAppLink>
  );
}
