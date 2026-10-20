/**
 * «ألبوم جديد» → «إنشاء ورفع»: the files chosen on the create form travel to the album editor in memory (same
 * browser tab, client-side navigation), so the upload starts there without choosing them again. A full page
 * reload clears this map — the editor then shows an empty uploader (nothing to resume without the files).
 */
const pending = new Map<string, File[]>();
export const putHandoff = (albumId: string, files: File[]) => void pending.set(albumId, files);
export function takeHandoff(albumId: string): File[] {
  const files = pending.get(albumId) ?? [];
  pending.delete(albumId);
  return files;
}
