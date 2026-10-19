/**
 * WhatsApp links. The studio number is verified as a WhatsApp Business account (wa.me shows the studio's
 * name), so prefilled messages use wa.me/<digits>?text=… . The business "message link" (wa.me/message/…)
 * carries its own preset text and cannot take ours; it is the fallback when no number is configured.
 */
export function whatsappHref(opts: { number?: string | null; messageLink?: string | null; text?: string }): string | null {
  const digits = (opts.number ?? "").replace(/\D/g, "");
  if (digits.length >= 8) {
    const q = opts.text ? `?text=${encodeURIComponent(opts.text)}` : "";
    return `https://wa.me/${digits}${q}`;
  }
  const link = opts.messageLink?.trim();
  if (link && /^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(link)) return link;
  return null;
}

export const BOOKING_TEXT = "مرحباً، بدي أحجز/أستفسر عن مناسبة مع ستوديو وتسجيلات السلطان.";
export const projectText = (title: string) => `مرحباً، شفت «${title}» على موقعكم وبدي أستفسر عن مناسبة.`;
