/** Editable public copy that is not stored in the database. Keep factual; no invented claims. */

export const HERO = {
  title: "فرحتك إلها حكاية",
  sub: "نوثّق أعراسكم ومناسباتكم بالصوت والصورة.",
  primary: "احجز عبر واتساب",
  secondary: "شاهد أعمالنا",
  /** Caption under the promo thumbnail. The promo is a ~9-minute clip, not a "short promo". */
  promoCaption: "مقطع من أعمالنا",
};

/** Used only when no services are published yet. */
export const FALLBACK_SERVICES = [
  {
    title: "تصوير فوتوغرافي",
    summary: "تصوير العرس والخطوبة والمناسبات من التحضيرات حتى آخر السهرة.",
  },
  {
    title: "أفلام أعراس",
    summary: "فيلم يحكي يومكم بترتيبه، بصوت الحفلة ولحظاتها الحقيقية.",
  },
  {
    title: "DJ وتنسيق الصوت",
    summary: "صوت وإضاءة للسهرة والزفة، وتنسيق مع برنامج المناسبة.",
  },
] as const;

/** Booking happens on WhatsApp only (no forms, no portal). */
export const STEPS = [
  { title: "راسلنا على واتساب", body: "اكتب نوع المناسبة وتاريخها ومكانها والخدمات اللي بتحتاجها." },
  { title: "نتفق على التفاصيل", body: "نرد عليك على واتساب أو بالهاتف ونتفق على الموعد والتفاصيل." },
  { title: "يوم المناسبة", body: "فريقنا يكون حاضراً في الوقت ويوثّق اليوم كما هو." },
  { title: "التسليم", body: "نتفق معك على طريقة وموعد استلام صورك وفيلمك." },
] as const;
