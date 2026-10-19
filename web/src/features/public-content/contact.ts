import { BOOKING_TEXT, whatsappHref } from "@/lib/whatsapp";
import type { BusinessSettings } from "./schema";
import { safeHttp } from "./seo";

export type ContactItem = {
  key: "whatsapp" | "phone" | "facebook" | "youtube" | "instagram" | "email" | "address";
  name: string;
  label: string;
  href: string | null;
  ltr?: boolean;
  external?: boolean;
};

/** The single booking/contact WhatsApp link used by every CTA on the site. */
export function bookingHref(s: BusinessSettings | null, text?: string): string | null {
  // Owner's default booking message (business_settings.booking_message) when no specific text is given.
  return whatsappHref({ number: s?.whatsapp, messageLink: s?.whatsapp_url, text: text ?? s?.booking_message ?? BOOKING_TEXT });
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/** Contact rows built from business_settings only; null fields are omitted. */
export function contactItems(s: BusinessSettings | null): ContactItem[] {
  if (!s) return [];
  const wa = bookingHref(s);
  const items: (ContactItem | null)[] = [
    wa ? { key: "whatsapp", name: "واتساب", label: "راسلنا على واتساب", href: wa, external: true } : null,
    s.phone ? { key: "phone", name: "الهاتف", label: s.phone, href: telHref(s.phone), ltr: true } : null,
    safeHttp(s.facebook) ? { key: "facebook", name: "فيسبوك", label: "صفحتنا على فيسبوك", href: s.facebook, external: true } : null,
    safeHttp(s.youtube_url) ? { key: "youtube", name: "يوتيوب", label: "قناتنا على YouTube", href: s.youtube_url, external: true } : null,
    safeHttp(s.instagram) ? { key: "instagram", name: "إنستغرام", label: "حسابنا على إنستغرام", href: s.instagram, external: true } : null,
    s.email ? { key: "email", name: "البريد", label: s.email, href: `mailto:${s.email}`, ltr: true } : null,
    s.address ? { key: "address", name: "العنوان", label: s.address, href: null } : null,
  ];
  return items.filter((x): x is ContactItem => x !== null);
}
