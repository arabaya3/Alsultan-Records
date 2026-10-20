/** Owner-facing text for a failed album photo (processing errors are stored in English in album_photos.last_error). */
export function photoErrorText(error: string | null | undefined): string {
  if (!error) return "تعذّرت المعالجة.";
  if (/original not found/i.test(error))
    return "الصورة ما وصلت للتخزين (انقطع الرفع). اختر نفس الصورة مرة ثانية من «إضافة صور» وبتنرفع مكانها.";
  return error;
}
