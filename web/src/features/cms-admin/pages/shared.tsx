import type { ReactNode } from "react";
import { Card, Field, inputCls, LoadError } from "@/features/admin/ui";
import { CmsForm } from "../CmsForm";
import { saveSectionIntro } from "../actions";
import type { Opt, SectionRow } from "../data";

/** Load-error view; says so plainly when the CMS migration is not applied yet. */
export function CmsLoadError({ error, what }: { error?: { code?: string } | null; what: string }) {
  if (error?.code === "42P01" || error?.code === "PGRST205" || error?.code === "42703" || error?.code === "PGRST204") {
    return (
      <div role="alert" className="rounded-md border border-gold/60 bg-gold/10 px-4 py-6 text-sm">
        قسم «{what}» يحتاج تحديث قاعدة البيانات (ترحيلات محتوى الموقع). بعد تطبيقها تظهر هنا تلقائياً.
      </div>
    );
  }
  return <LoadError what={what} />;
}

/** Multi-select as checkboxes (videos / albums / services / offers). */
export function CheckList({ name, legend, options, selected, max }: { name: string; legend: string; options: Opt[]; selected: string[]; max?: number }) {
  const set = new Set(selected);
  return (
    <details className="rounded-md border border-cream-line p-2 text-sm" open={selected.length > 0}>
      <summary className="min-h-10 cursor-pointer py-2 font-medium">
        {legend} {selected.length ? `(${selected.length})` : ""}
      </summary>
      {options.length ? (
        <fieldset>
          <legend className="sr-only">{legend}</legend>
          {max ? <p className="mb-1 text-xs text-on-cream-muted">حتى {max} عناصر.</p> : null}
          <ul className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
            {options.map((o) => (
              <li key={o.id}>
                <label className="flex min-h-10 items-center gap-2 rounded-sm px-1 hover:bg-cream-2">
                  <input type="checkbox" name={name} value={o.id} defaultChecked={set.has(o.id)} />
                  <span className="min-w-0 break-words">
                    {o.title}
                    {o.hidden ? <span className="text-xs text-on-cream-muted"> (مخفي)</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : (
        <p className="text-on-cream-muted">لا توجد عناصر بعد.</p>
      )}
    </details>
  );
}

export function SectionIntroCard({ section, sectionKey, note }: { section: SectionRow | null; sectionKey: string; note?: ReactNode }) {
  return (
    <Card title="عنوان القسم ومقدمته">
      {note ? <p className="mb-3 text-sm text-on-cream-muted">{note}</p> : null}
      <CmsForm action={saveSectionIntro} testId={`section-intro-${sectionKey}`}>
        <input type="hidden" name="key" value={sectionKey} />
        <div className="grid gap-3">
          <Field label="العنوان" hint="حتى 120 حرفاً. اتركه فارغاً لاستخدام العنوان الافتراضي.">
            <input name="title" maxLength={120} defaultValue={section?.title ?? ""} className={inputCls} />
          </Field>
          <Field label="المقدمة" hint="حتى 600 حرف. نص عادي.">
            <textarea name="intro" rows={3} maxLength={600} defaultValue={section?.intro ?? ""} className={inputCls} />
          </Field>
        </div>
      </CmsForm>
    </Card>
  );
}

export const today = (d: string) => `اليوم حسب توقيت الخليل/فلسطين: ${d}`;
export const DATE_HELP = "التواريخ تُحسب بتوقيت فلسطين (Asia/Hebron) وتشمل يوم البداية ويوم النهاية. بعد يوم النهاية يختفي تلقائياً بدون أي إجراء.";
