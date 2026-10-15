/** Money helpers. Amounts are integer minor units (agorot). Parsing never goes through floats. */
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** "1,250.5" -> 125050. Returns null for invalid, negative or too-large input. */
export function parseMoneyToMinor(input: string): number | null {
  const s = input
    .trim()
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/٫/g, ".")
    .replace(/[,\s٬₪]/g, "");
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? "").padEnd(2, "0"));
  const minor = whole * 100 + frac;
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 125050 -> "₪ 1,250.50" using integer arithmetic only. */
export function formatMinor(minor: number | null | undefined, currency = "ILS"): string {
  if (minor === null || minor === undefined) return "—";
  const neg = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const sym = currency.trim() === "ILS" ? "₪" : currency;
  return `${neg ? "-" : ""}${sym} ${whole.toLocaleString("en-US")}.${frac}`;
}

export function minorToInput(minor: number): string {
  const abs = Math.abs(Math.trunc(minor));
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
