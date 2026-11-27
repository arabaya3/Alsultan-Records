import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { Field, inputCls, Notice, PageHeader } from "@/features/admin/ui";
import { Modal } from "@/features/admin/Modal";
import { ToggleAction } from "@/features/admin/ToggleAction";
import { SwitchField } from "@/features/admin/SwitchField";
import { IconEdit, IconInfo, IconLock } from "@/features/admin/icons";
import { isSiteTarget, type SiteTarget } from "@/lib/site-targets";
import { cms } from "../db";
import { CmsForm } from "../CmsForm";
import { SortableList } from "../SortableList";
import { pickAlbums, pickOffers, pickVideos, type Opt, type SectionRow } from "../data";
import { PAGE_TARGET_LABEL, PAGE_TARGET_PATH, SECTION_FEATURE, SECTION_FIELDS, SECTION_KEYS, SECTION_LABEL, type SectionKey } from "../targets";
import { saveNavItem, saveOrder, saveSection, saveSectionOrder, setSectionVisible } from "../actions";
import { CheckList, CmsLoadError } from "./shared";
import { LONG_TEXT, LONG_TEXT_HINT } from "@/lib/text-limits";

type Nav = { id: string; label: string; target: string; sort_order: number; is_visible: boolean };

/**
 * «القائمة العلوية»: one row per header link — drag to reorder, switch to show/hide, «تعديل» opens a small dialog for
 * the name and visibility. The URL is fixed by the allow-list and shown read-only. Links whose page was removed are
 * listed above, locked.
 */
export async function NavSectionsPage() {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sb = await cms();
  const nav = await sb.from("nav_items").select("id, label, target, sort_order, is_visible").order("sort_order");
  if (nav.error) return <CmsLoadError error={nav.error} what="القائمة" />;
  const items = (nav.data ?? []) as Nav[];
  const live = items.filter((n) => isSiteTarget(n.target));
  const retired = items.filter((n) => !isSiteTarget(n.target));

  return (
    <>
      <PageHeader title="القائمة العلوية" lead="رتّب روابط الموقع وعدّل أسماءها وظهورها." />
      <div className="rounded-2xl border border-cream-line bg-[#fffdf8] p-4 shadow-[0_8px_24px_-20px_rgb(60_45_20/0.4)] md:p-6">
        {retired.map((n) => (
          <p
            key={n.id}
            data-testid={`nav-retired-${n.target}`}
            className="mb-3 flex items-center gap-3 rounded-xl bg-cream-2 px-4 py-3 text-sm text-on-cream-muted"
          >
            <IconLock size={20} />
            <span>
              <span className="font-bold text-on-cream">{n.label}</span> — أزيلت من الموقع ولا يمكن تعديلها.
            </span>
          </p>
        ))}
        {live.length ? (
          <SortableList
            label="ترتيب روابط القائمة"
            table="nav_items"
            action={saveOrder}
            testId="nav-list"
            items={live.map((n) => ({
              id: n.id,
              content: (
                <div data-testid={`nav-row-${n.target}`}>
                  <p className="font-display text-base font-bold md:text-lg">{n.label}</p>
                  <p className="text-sm text-on-cream-muted" dir="ltr" style={{ textAlign: "end" }}>
                    {PAGE_TARGET_PATH(n.target as SiteTarget)}
                  </p>
                  {n.target === "offers" ? <p className="text-xs text-on-cream-muted">يظهر عند وجود عرض ساري</p> : null}
                </div>
              ),
              trailing: (
                <div className="flex shrink-0 items-center gap-3">
                  <ToggleAction
                    action={saveNavItem}
                    on={n.is_visible}
                    label={`إظهار في القائمة: ${n.label}`}
                    testId={`nav-toggle-${n.target}`}
                    fields={
                      <>
                        <input type="hidden" name="id" value={n.id} />
                        <input type="hidden" name="label" value={n.label} />
                        {n.is_visible ? null : <input type="hidden" name="is_visible" value="on" />}
                      </>
                    }
                  />
                  <Modal
                    title="تعديل رابط القائمة"
                    size="sm"
                    testId={`nav-${n.target}-modal`}
                    trigger={
                      <>
                        <IconEdit size={16} /> تعديل
                      </>
                    }
                    triggerClassName="inline-flex min-h-11 items-center gap-2 rounded-lg border border-cream-line bg-[#fffdf8] px-4 text-sm font-semibold hover:border-on-cream-muted"
                  >
                    <p className="mb-4 text-sm text-on-cream-muted">تعديل بيانات رابط «{n.label}».</p>
                    <CmsForm action={saveNavItem} testId={`nav-${n.target}`} intents={[{ intent: "save", label: "حفظ التغيير", kind: "primary" }]}>
                      <input type="hidden" name="id" value={n.id} />
                      <Field label="الاسم في القائمة" hint={`يفتح ${PAGE_TARGET_LABEL[n.target as SiteTarget]}`}>
                        <input name="label" required maxLength={30} defaultValue={n.label} className={inputCls} />
                      </Field>
                      <div className="text-sm">
                        <span className="mb-1 block font-medium">وجهة الرابط (المسار)</span>
                        <div className="relative">
                          <input value={PAGE_TARGET_PATH(n.target as SiteTarget)} readOnly disabled dir="ltr" aria-label="وجهة الرابط (المسار)" className={`${inputCls} cursor-not-allowed bg-cream-2 !pr-11 text-on-cream-muted`} />
                          <span aria-hidden="true" className="absolute inset-y-0 right-3 flex items-center text-on-cream-muted">
                            <IconLock size={18} />
                          </span>
                        </div>
                        <span className="mt-1 flex items-center gap-1.5 text-xs text-on-cream-muted">
                          <IconInfo size={15} /> لا يمكن تغيير مسار الرابط.
                        </span>
                      </div>
                      <SwitchField name="is_visible" label="الظهور في القائمة" defaultChecked={n.is_visible} />
                      {n.target === "offers" ? <p className="text-xs text-on-cream-muted">يظهر للزوار فقط عند وجود عرض ساري.</p> : null}
                    </CmsForm>
                  </Modal>
                </div>
              ),
            }))}
          />
        ) : (
          <Notice>لا توجد روابط. يعرض الموقع القائمة الافتراضية.</Notice>
        )}
        <p className="mt-2 text-xs text-on-cream-muted">صفحات الإدارة وتسجيل الدخول ليست ضمن القائمة ولا يمكن إضافتها هنا.</p>
      </div>
    </>
  );
}

type HomeSection = SectionRow & { key: SectionKey };
export type HomeSectionsData = { sections: HomeSection[]; opts: Record<NonNullable<(typeof SECTION_FEATURE)[SectionKey]>, Opt[]> };

/** The home page sections and the pick lists their forms need (one read for the home editor). */
export async function loadHomeSections(): Promise<HomeSectionsData | { error: { code?: string } }> {
  const sb = await cms();
  const [sec, videos, offers, albums] = await Promise.all([
    sb.from("site_sections").select("key, title, intro, is_visible, sort_order, item_limit, featured_ids, stat_value").order("sort_order"),
    pickVideos(sb),
    pickOffers(sb),
    pickAlbums(sb),
  ]);
  if (sec.error) return { error: sec.error };
  const sections = ((sec.data ?? []) as SectionRow[]).filter((s): s is HomeSection => (SECTION_KEYS as readonly string[]).includes(s.key));
  return { sections, opts: { video: videos, offer: offers, album: albums } };
}

/** «الأقسام»: order (drag or ↑/↓ on the handle) and show/hide (switch). */
export function SectionsOrder({ sections }: { sections: HomeSection[] }) {
  return (
    <div>
      <p className="mb-3 text-sm text-on-cream-muted">
        رتّب الأقسام وأظهرها أو أخفها: الصفحة الرئيسية تعرض الأقسام الظاهرة بهذا الترتيب تحت الواجهة. القسم بلا محتوى منشور لا يظهر حتى لو كان مفعّلاً.
      </p>
      <div className="mb-4" data-testid="poster-note">
        <Notice>
          التصميم المعتمد للرئيسية هو: «من نحن» ثم «كيف نوثّق مناسبتكم» ثم «من أعمالنا» ثم «تواصل معنا». باقي الأقسام (العروض، الألبومات، العدّاد، البرومو، طريقة
          شغلنا) تظهر بنفس الأسلوب إذا أظهرتها.
        </Notice>
      </div>
      <SortableList
        label="ترتيب أقسام الرئيسية"
        action={saveSectionOrder}
        testId="sections-order"
        items={sections.map((s) => ({
          id: s.key,
          content: (
            <div className="flex flex-wrap items-center gap-2" data-testid="section-row" data-key={s.key}>
              <span className="min-w-0 flex-1 font-display font-bold">{s.title || SECTION_LABEL[s.key]}</span>
              <span className="text-xs text-on-cream-muted">{SECTION_LABEL[s.key]}</span>
            </div>
          ),
          trailing: (
            <ToggleAction
              action={setSectionVisible}
              on={s.is_visible}
              label={`إظهار القسم: ${s.title || SECTION_LABEL[s.key]}`}
              testId={`section-toggle-${s.key}`}
              fields={
                <>
                  <input type="hidden" name="key" value={s.key} />
                  <input type="hidden" name="value" value={s.is_visible ? "0" : "1"} />
                </>
              }
            />
          ),
        }))}
      />
    </div>
  );
}

/** «محتوى الأقسام»: the chosen section's own form (title, intro, number, picks…). Same fields and rules as before. */
export function SectionForm({ s, opts }: { s: HomeSection; opts: HomeSectionsData["opts"] }) {
  const kind = SECTION_FEATURE[s.key];
  const uses = SECTION_FIELDS[s.key];
  const off = "cursor-not-allowed bg-cream-2 text-on-cream-muted";
  return (
    <CmsForm action={saveSection} testId={`section-${s.key}`}>
      <input type="hidden" name="key" value={s.key} />
      <div className="grid gap-4">
        {uses.why ? (
          <p className="rounded-md border border-cream-line bg-cream-2 px-3 py-2 text-sm text-on-cream-muted" data-testid="section-why">
            {uses.why}
          </p>
        ) : null}
        {uses.title ? (
          <div className="flex items-center justify-between gap-4 rounded-xl bg-cream-2 px-5 py-6" aria-hidden="true" data-testid="section-title-preview">
            <span className="h-px flex-1 bg-gold" />
            <span className="font-display text-2xl font-bold">{s.title || SECTION_LABEL[s.key]}</span>
            <span className="h-px flex-1 bg-gold" />
          </div>
        ) : null}
        {uses.title ? (
          <Field label="العنوان">
            <input name="title" maxLength={120} defaultValue={s.title ?? ""} className={inputCls} />
          </Field>
        ) : (
          <>
            <input type="hidden" name="title" value={s.title ?? ""} />
            <Field label="العنوان" hint="غير مستخدم في هذا القسم.">
              <input disabled value={s.title ?? ""} readOnly className={`${inputCls} ${off}`} data-testid="off-title" />
            </Field>
          </>
        )}
        {uses.intro ? (
          <Field label="المقدمة" hint={LONG_TEXT_HINT}>
            <textarea name="intro" rows={3} maxLength={LONG_TEXT} defaultValue={s.intro ?? ""} className={inputCls} />
          </Field>
        ) : (
          <>
            <input type="hidden" name="intro" value={s.intro ?? ""} />
            <Field label="المقدمة" hint="غير مستخدمة في هذا القسم.">
              <textarea disabled rows={2} value={s.intro ?? ""} readOnly className={`${inputCls} ${off}`} data-testid="off-intro" />
            </Field>
          </>
        )}
        {s.key === "stats" ? (
          <Field label="الرقم" hint="العدد الحقيقي للحفلات والمناسبات اللي وثّقها الاستوديو. القسم ما بظهر بالموقع بدون رقم.">
            <input name="stat_value" type="number" inputMode="numeric" min={1} max={10000000} step={1} defaultValue={s.stat_value ?? ""} className={inputCls} data-testid="stat-value" />
          </Field>
        ) : null}
        <div className="grid items-end gap-3 sm:grid-cols-2">
          {uses.limit ? (
            <Field label="عدد العناصر" hint="من 1 إلى 12">
              <input name="item_limit" type="number" inputMode="numeric" min={1} max={12} step={1} defaultValue={s.item_limit} className={inputCls} />
            </Field>
          ) : (
            // Not used by this section: the stored number goes back unchanged.
            <input type="hidden" name="item_limit" value={s.item_limit} />
          )}
          <SwitchField name="is_visible" label="الظهور في الرئيسية" defaultChecked={s.is_visible} />
        </div>
        {kind && !uses.featured ? (s.featured_ids ?? []).map((id) => <input key={id} type="hidden" name="featured_ids" value={id} />) : null}
        {kind && uses.featured ? (
          <CheckList name="featured_ids" legend={kind === "album" ? "ألبومات مختارة يدوياً" : "عناصر مميزة (تظهر أولاً)"} options={opts[kind]} selected={s.featured_ids ?? []} max={12} />
        ) : null}
        {kind === "album" ? (
          <p className="text-sm text-muted" data-testid="albums-featured-note">
            {(s.featured_ids ?? []).length
              ? "قسم «أحدث الألبومات» في الرئيسية يعرض الألبومات حسب أحدث نشر فقط. اختياراتك محفوظة كما هي ولا تُدخَل بينها."
              : "بدون اختيار: الرئيسية تعرض أحدث الألبومات المنشورة (حسب تاريخ النشر). صفحة الألبومات تعرض الأحدث نشراً دائماً."}
          </p>
        ) : null}
      </div>
    </CmsForm>
  );
}
