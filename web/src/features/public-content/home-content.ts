/** Editable public copy that is not stored in the database. Keep factual; no invented claims. */

export const HERO = {
  title: "فرحتك إلها حكاية",
  sub: "نوثّق أعراسكم ومناسباتكم بالصوت والصورة.",
  primary: "شاهد أعمالنا",
  secondary: "احكِ لنا عن مناسبتك",
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

export const STEPS = [
  { title: "احكِ لنا", body: "أرسل تفاصيل مناسبتك الأساسية: النوع والتاريخ والمكان." },
  { title: "نتفق على التفاصيل", body: "نتواصل معك لنفهم ما تحتاجه ونرسل لك عرضاً واضحاً." },
  { title: "يوم المناسبة", body: "فريقنا يكون حاضراً في الوقت ويوثّق اليوم كما هو." },
  { title: "التسليم", body: "تستلم صورك وفيلمك عبر بوابة العميل." },
] as const;
