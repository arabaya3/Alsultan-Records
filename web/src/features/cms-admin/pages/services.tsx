import Link from "next/link";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, btn, Card, Field, inputCls, Notice, PageHeader } from "@/features/admin/ui";
import { isUuid } from "@/features/admin/result";
import type { IdParams, SP } from "@/features/admin/query";
import { cms } from "../db";
import { CmsForm } from "../CmsForm";
import { PhotoPicker, SlugField } from "../fields";
import { SortableList } from "../SortableList";
import { loadSection, pickAlbums, pickPhotos, pickVideos } from "../data";
import { deleteRow, saveOrder, saveService, saveStep, setVisible } from "../actions";
import { CheckList, CmsLoadError, PageTabs, SectionIntroCard, SERVICES_TABS } from "./shared";
import { LONG_TEXT, LONG_TEXT_HINT } from "@/lib/text-limits";

type Service = { id: string; slug: string; title: string; summary: string | null; body: string | null; cover_photo_id: string | null; is_published: boolean; sort_order: number };

function VisibleToggle({ table, id, on }: { table: string; id: string; on: boolean }) {
  return (
    <ActionForm action={setVisible} submitLabel={on ? "إخفاء" : "نشر"} kind="ghost" inline>
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="value" value={on ? "0" : "1"} />
    </ActionForm>
  );
}

export async function ServicesPage() {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sb = await cms();
  const [{ data, error }, section] = await Promise.all([
    sb.from("services").select("id, slug, title, summary, is_published, sort_order").order("sort_order").order("created_at"),
    loadSection(sb, "services"),
  ]);
  if (error) return <CmsLoadError error={error} what="الخدمات" />;
  const rows = (data ?? []) as Service[];
  return (
    <>
      <PageHeader
        title="الخدمات"
        back={{ href: "/admin/content", label: "محتوى الموقع" }}
        lead="هون بتضيف الخدمات اللي بتظهر بالموقع وبترتّبها. اسحب ⋮⋮ أو استخدم الأسهم لتغيير الترتيب. المخفية لا تظهر للزوار."
        actions={
          <Link href="/admin/content/services/new" className={btn("primary")}>
            + خدمة جديدة
          </Link>
        }
      />
      <PageTabs label="أقسام الخدمات" tabs={SERVICES_TABS} current="/admin/content/services" />
      <div className="space-y-4">
        {rows.length ? (
          <SortableList
            label="ترتيب الخدمات"
            table="services"
            action={saveOrder}
            testId="services-list"
            items={rows.map((s) => ({
              id: s.id,
              content: (
                <div className="flex flex-wrap items-center gap-2" data-testid="service-row" data-slug={s.slug}>
                  <Link href={`/admin/content/services/${s.id}`} className="min-w-0 flex-1 break-words font-medium underline-offset-4 hover:underline">
                    {s.title}
                  </Link>
                  {s.is_published ? <Badge tone="success">منشورة</Badge> : <Badge>مخفية</Badge>}
                  <VisibleToggle table="services" id={s.id} on={s.is_published} />
                </div>
              ),
            }))}
          />
        ) : (
          <Notice>لا توجد خدمات بعد. يعرض الموقع النص الافتراضي حتى تضيف خدمة منشورة.</Notice>
        )}
        <SectionIntroCard section={section} sectionKey="services" />
      </div>
    </>
  );
}

export async function ServiceEditPage({ params, searchParams }: { params: IdParams; searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const { id } = await params;
  const saved = (await searchParams).saved === "1";
  const isNew = id === "new";
  if (!isNew && !isUuid(id)) return <CmsLoadError what="الخدمة" />;
  const sb = await cms();
  const [row, links, photos, videos, albums] = await Promise.all([
    isNew ? Promise.resolve({ data: null, error: null }) : sb.from("services").select("id, slug, title, summary, body, cover_photo_id, is_published, sort_order").eq("id", id).maybeSingle(),
    isNew ? Promise.resolve({ data: [] }) : sb.from("service_links").select("kind, target_id, sort_order").eq("service_id", id).order("sort_order"),
    pickPhotos(sb),
    pickVideos(sb),
    pickAlbums(sb),
  ]);
  if (row.error || (!isNew && !row.data)) return <CmsLoadError error={row.error} what="الخدمة" />;
  const s = row.data as Service | null;
  const l = (links.data ?? []) as { kind: string; target_id: string }[];
  return (
    <>
      <PageHeader title={s ? s.title : "خدمة جديدة"} back={{ href: "/admin/content/services", label: "الخدمات" }} />
      {saved ? <div className="mb-4"><Notice tone="success">حُفظت الخدمة.</Notice></div> : null}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card title="بيانات الخدمة">
          <CmsForm
            action={saveService}
            testId="service-form"
            intents={
              s?.is_published
                ? [
                    { intent: "publish", label: "حفظ", kind: "primary" },
                    { intent: "draft", label: "إخفاء", kind: "ghost" },
                  ]
                : [
                    { intent: "draft", label: "حفظ مسودة", kind: "ghost" },
                    { intent: "publish", label: "نشر", kind: "primary" },
                  ]
            }
          >
            {s ? <input type="hidden" name="id" value={s.id} /> : null}
            <div className="grid gap-3">
              <Field label="عنوان الخدمة" hint="2–120 حرفاً.">
                <input name="title" required minLength={2} maxLength={120} defaultValue={s?.title ?? ""} className={inputCls} />
              </Field>
              <SlugField defaultValue={s?.slug} prefix="/services" />
              <Field label="ملخص قصير" hint={`${LONG_TEXT_HINT} يظهر في البطاقة.`}>
                <textarea name="summary" rows={2} maxLength={LONG_TEXT} defaultValue={s?.summary ?? ""} className={inputCls} />
              </Field>
              <Field label="التفاصيل" hint="نص عادي؛ اترك سطراً فارغاً بين الفقرات.">
                <textarea name="body" rows={6} maxLength={LONG_TEXT} defaultValue={s?.body ?? ""} className={inputCls} />
              </Field>
              <PhotoPicker name="cover_photo_id" label="صورة الغلاف" photos={photos} defaultValue={s?.cover_photo_id} />
              <CheckList name="video_ids" legend="فيديوهات مرتبطة" options={videos} selected={l.filter((x) => x.kind === "video").map((x) => x.target_id)} />
              <CheckList name="album_ids" legend="ألبومات مرتبطة" options={albums} selected={l.filter((x) => x.kind === "album").map((x) => x.target_id)} />
              <p className="text-xs text-on-cream-muted">الحالة الحالية: {s?.is_published ? "منشورة" : "مسودة/مخفية"}. «حفظ مسودة» يخفيها، «نشر» يظهرها.</p>
            </div>
          </CmsForm>
        </Card>
        {s ? (
          <div className="space-y-4">
            <Card title="المعاينة">
              <a href={`/services/${s.slug}`} target="_blank" rel="noopener" className={btn("ghost")}>
                فتح صفحة الخدمة
              </a>
              {!s.is_published ? <p className="mt-2 text-xs text-on-cream-muted">الخدمة مخفية: الزوار لا يرونها.</p> : null}
            </Card>
            <Card title="حذف">
              <ActionForm action={deleteRow} submitLabel="حذف الخدمة" kind="danger" confirm={{ title: "حذف هذه الخدمة؟", body: "تُزال نهائياً من الموقع. الصور والفيديوهات المرتبطة لا تتأثر.", confirmLabel: "حذف" }}>
                <input type="hidden" name="table" value="services" />
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="from" value="edit" />
              </ActionForm>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}

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
      <PageHeader title="طريقة شغلنا" back={{ href: "/admin/content", label: "محتوى الموقع" }} lead="هون بتكتب خطوات الشغل مع العميل؛ بتظهر بالترتيب في الرئيسية." />
      <PageTabs label="أقسام الخدمات" tabs={SERVICES_TABS} current="/admin/content/process" />
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
