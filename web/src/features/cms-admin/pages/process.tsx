import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, Field, inputCls, Notice, PageHeader } from "@/features/admin/ui";
import { cms } from "../db";
import { CmsForm } from "../CmsForm";
import { PhotoPicker } from "../fields";
import { SortableList } from "../SortableList";
import { loadSection, pickPhotos } from "../data";
import { deleteRow, saveOrder, saveStep } from "../actions";
import { CmsLoadError, SectionIntroCard } from "./shared";
import { LONG_TEXT, LONG_TEXT_HINT } from "@/lib/text-limits";

// ------------------------------------------------------------------ process steps
type Step = { id: string; title: string; description: string | null; photo_id: string | null; is_published: boolean };

function StepFields({ s, photos }: { s?: Step; photos: Awaited<ReturnType<typeof pickPhotos>> }) {
  return (
    <div className="grid gap-3">
      {s ? <input type="hidden" name="id" value={s.id} /> : null}
      <Field label="عنوان الخطوة" hint="حتى 80 حرفاً.">
        <input name="title" required minLength={2} maxLength={80} defaultValue={s?.title ?? ""} className={inputCls} />
      </Field>
      <Field label="الوصف" hint={LONG_TEXT_HINT}>
        <textarea name="description" rows={2} maxLength={LONG_TEXT} defaultValue={s?.description ?? ""} className={inputCls} />
      </Field>
      <PhotoPicker name="photo_id" label="صورة (اختياري)" photos={photos} defaultValue={s?.photo_id} />
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" name="is_published" defaultChecked={s ? s.is_published : true} /> ظاهرة في الموقع
      </label>
    </div>
  );
}

export async function ProcessPage() {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sb = await cms();
  const [{ data, error }, section, photos] = await Promise.all([
    sb.from("process_steps").select("id, title, description, photo_id, is_published").order("sort_order").order("created_at"),
    loadSection(sb, "process"),
    pickPhotos(sb),
  ]);
  if (error) return <CmsLoadError error={error} what="طريقة شغلنا" />;
  const steps = (data ?? []) as Step[];
  return (
    <>
      <PageHeader title="طريقة شغلنا" back={{ href: "/admin/content/home", label: "الصفحة الرئيسية" }} lead="هون بتكتب خطوات الشغل مع العميل؛ بتظهر بالترتيب في الرئيسية." />
      <div className="space-y-4">
        {steps.length ? (
          <SortableList
            label="ترتيب الخطوات"
            table="process_steps"
            action={saveOrder}
            testId="steps-list"
            items={steps.map((s, i) => ({
              id: s.id,
              content: (
                <details data-testid="step-row">
                  <summary className="flex min-h-10 cursor-pointer flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {i + 1}. {s.title}
                    </span>
                    {s.is_published ? <Badge tone="success">ظاهرة</Badge> : <Badge>مخفية</Badge>}
                  </summary>
                  <div className="mt-3 space-y-3">
                    <CmsForm action={saveStep}>
                      <StepFields s={s} photos={photos} />
                    </CmsForm>
                    <ActionForm action={deleteRow} submitLabel="حذف الخطوة" kind="danger" confirm={{ title: "حذف هذه الخطوة؟", confirmLabel: "حذف" }}>
                      <input type="hidden" name="table" value="process_steps" />
                      <input type="hidden" name="id" value={s.id} />
                    </ActionForm>
                  </div>
                </details>
              ),
            }))}
          />
        ) : (
          <Notice>لا توجد خطوات. يعرض الموقع الخطوات الافتراضية.</Notice>
        )}
        <Card title="إضافة خطوة">
          <CmsForm action={saveStep} resetOnSuccess intents={[{ intent: "save", label: "إضافة", kind: "primary" }]} testId="step-create">
            <StepFields photos={photos} />
          </CmsForm>
        </Card>
        <SectionIntroCard section={section} sectionKey="process" />
      </div>
    </>
  );
}
