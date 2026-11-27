/** Arabic label for a stored payment method (same wording as the admin PaymentForm options). Unknown values pass through. */
const METHOD_AR: Record<string, string> = {
  cash: "نقداً",
  bank_transfer: "تحويل بنكي",
  cheque: "شيك",
  card: "بطاقة",
  other: "أخرى",
};

export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return "";
  return METHOD_AR[method] ?? method;
}
