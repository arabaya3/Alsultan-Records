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
/** Booking happens on WhatsApp only (no forms, no portal). */
export const STEPS = [
  { title: "راسلنا على واتساب", body: "اكتب نوع المناسبة وتاريخها ومكانها والخدمات اللي بتحتاجها." },
  { title: "نتفق على التفاصيل", body: "نرد عليك على واتساب أو بالهاتف ونتفق على الموعد والتفاصيل." },
  { title: "يوم المناسبة", body: "فريقنا يكون حاضراً في الوقت ويوثّق اليوم كما هو." },
  { title: "التسليم", body: "نتفق معك على طريقة وموعد استلام صورك وفيلمك." },
] as const;

/** Homepage poster copy, exactly as the owner's design shows it. Contact details come from business_settings. */
export const HOME_POSTER = {
  titleLines: ["وراء كل مناسبة حكاية", "تستحق أن تُروى"],
  location: "ميثلون — جنين",
  cta: "تواصل عبر واتساب",
  about: {
    title: "من نحن",
    body: "ستوديو فلسطيني متخصص بتوثيق المناسبات صوتًا وصورة.",
    team: ["طاقم نسائي منفصل", "طاقم شباب مختص"],
  },
  services: {
    title: "كيف نوثّق مناسبتكم",
    items: [
      { title: "تصوير فوتوغرافي", body: "توثيق أجمل لحظات مناسبتكم بصور تُعبّر عن تفاصيلها." },
      { title: "تصوير فيديو", body: "تغطية مرئية متكاملة للمناسبة بجودة احترافية." },
    ],
  },
  works: { title: "من أعمالنا", empty: "ننشر أعمالنا هنا قريبًا." },
  contactTitle: "تواصل معنا",
  /** Shown only when business_settings has no phone (the number on the owner's design). */
  phoneFallback: "+972 59-867-7477",
} as const;
