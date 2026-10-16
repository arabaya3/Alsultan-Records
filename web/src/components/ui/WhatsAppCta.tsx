import Link from "next/link";
import { bookingHref } from "@/features/public-content/contact";
import { getBusinessSettings } from "@/features/public-content/queries";

export function WhatsAppIcon({ size = 20 }: { size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
    </svg>
  );
}

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
