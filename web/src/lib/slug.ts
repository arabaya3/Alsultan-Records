/**
 * Slug suggestion for NEW records from their (usually Arabic) title: a simple letter-by-letter transliteration,
 * then lowercase Latin, digits and single hyphens. It is only a starting point the admin can edit; existing records
 * never get a new slug automatically (published links stay as they are). Uniqueness is checked by the server.
 */
const MAP: Record<string, string> = {
  ا: "a", أ: "a", إ: "i", آ: "a", ٱ: "a", ب: "b", ت: "t", ث: "th", ج: "j", ح: "h", خ: "kh", د: "d", ذ: "th", ر: "r",
  ز: "z", س: "s", ش: "sh", ص: "s", ض: "d", ط: "t", ظ: "z", ع: "a", غ: "gh", ف: "f", ق: "q", ك: "k", ل: "l", م: "m",
  ن: "n", ه: "h", ة: "h", و: "w", ؤ: "o", ي: "y", ى: "a", ئ: "e", ء: "", پ: "p", چ: "ch", گ: "g", ڤ: "v",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

export function slugFromTitle(title: string, max = 60): string {
  return title
    .replace(/[ً-ٰٟـ]/g, "") // harakat + tatweel
    .split("")
    .map((c) => MAP[c] ?? c)
    .join("")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}
