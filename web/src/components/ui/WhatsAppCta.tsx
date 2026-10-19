import Link from "next/link";
import { bookingHref } from "@/features/public-content/contact";
import { getBusinessSettings } from "@/features/public-content/queries";
import { buttonClasses, type ButtonSize, type ButtonTone } from "./Button";
import { WhatsAppIcon } from "./WhatsAppIcon";

export { WhatsAppIcon };

type CtaVariant = "primary" | "outline";

/**
 * A WhatsApp anchor (opens a new tab, keeps data-whatsapp-cta). Pass an already-built href.
 * Props: href, children? (default «احجز عبر واتساب»), size? "md"|"lg", variant? "primary" (gold) | "outline",
 * tone? "dark"|"light" (outline only), className?.
 */
export function WhatsAppLink({
  href,
  children = "احجز عبر واتساب",
  size = "md",
  variant = "primary",
  tone = "dark",
  className = "",
}: {
  href: string;
  children?: React.ReactNode;
  size?: ButtonSize;
  variant?: CtaVariant;
  tone?: ButtonTone;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-whatsapp-cta
      className={buttonClasses({ variant, tone, size, className: size === "lg" ? `px-7 ${className}` : className })}
    >
      <WhatsAppIcon size={size === "lg" ? 22 : 20} />
      <span>{children}</span>
    </a>
  );
}

/**
 * Booking CTA from business_settings; if no WhatsApp is configured, falls back to /contact.
 * Props: text? (prefilled message), label?, size?, variant?, tone?, className?.
 */
export async function WhatsAppCta({
  text,
  label = "احجز عبر واتساب",
  size = "md",
  variant = "primary",
  tone = "dark",
  className = "",
}: {
  text?: string;
  label?: string;
  size?: ButtonSize;
  variant?: CtaVariant;
  tone?: ButtonTone;
  className?: string;
}) {
  const settings = await getBusinessSettings();
  const href = bookingHref(settings.status === "ok" ? settings.data : null, text);
  if (!href) {
    return (
      <Link href="/contact" className={buttonClasses({ variant, tone, size, className })}>
        تواصل معنا
      </Link>
    );
  }
  return (
    <WhatsAppLink href={href} size={size} variant={variant} tone={tone} className={className}>
      {label}
    </WhatsAppLink>
  );
}
