/** Owner-facing text for a failed album photo (processing errors are stored in English in album_photos.last_error).
 *  Every failure keeps the original untouched in private storage; only the web copies are missing. */
const MAP: [RegExp, string][] = [
  [/original not found/i, "الصورة ما وصلت للتخزين (انقطع الرفع). اختر نفس الصورة مرة ثانية من «إضافة صور» وبتنرفع مكانها."],
  [/RAW file could not be read|RAW decode failed|unexpected pixel format|truncated image/i, "ملف RAW هذا غير مدعوم (كاميرا أو ضغط أحدث من قارئ RAW) أو تالف. الأصل محفوظ كما هو، بس ما انعملت له نسخة عرض."],
  [/image could not be decoded/i, "الصورة تالفة أو صيغتها غير مدعومة. الأصل محفوظ كما هو، بس ما انعملت له نسخة عرض."],
  [/file content does not match/i, "محتوى الملف ما بطابق نوعه (امتداد مزوّر أو ملف تالف)."],
  [/image too large/i, "أبعاد الصورة أكبر من الحد المسموح للمعالجة (150 ميغابكسل)."],
  [/checksum mismatch/i, "الملف تغيّر أثناء الرفع — احذفه وارفعه مرة ثانية."],
  [/size out of range/i, "حجم الملف المخزّن خارج الحد المسموح."],
  [/unsupported type/i, "نوع الملف غير مدعوم."],
  [/variant upload failed/i, "تعذّر حفظ نسخة العرض — جرّب «إعادة المحاولة»."],
];

export function photoErrorText(error: string | null | undefined): string {
  if (!error) return "تعذّرت المعالجة.";
  return MAP.find(([re]) => re.test(error))?.[1] ?? error;
}
