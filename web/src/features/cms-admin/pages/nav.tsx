import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, Field, inputCls, Notice, PageHeader } from "@/features/admin/ui";
import { isSiteTarget } from "@/lib/site-targets";
import { cms } from "../db";
import { CmsForm } from "../CmsForm";
import { SortableList } from "../SortableList";
import { pickAlbums, pickOffers, pickServices, pickVideos, type Opt, type SectionRow } from "../data";
import { PAGE_TARGET_LABEL, PAGE_TARGET_PATH, SECTION_FEATURE, SECTION_KEYS, SECTION_LABEL, type SectionKey } from "../targets";
import { saveNavItem, saveOrder, saveSection, saveSectionOrder, setSectionVisible } from "../actions";
import { CheckList, CmsLoadError } from "./shared";
import { LONG_TEXT, LONG_TEXT_HINT } from "@/lib/text-limits";

type Nav = { id: string; label: string; target: string; sort_order: number; is_visible: boolean };

export async function NavSectionsPage() {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sb = await cms();
  const [nav, sec, videos, services, offers, albums] = await Promise.all([
    sb.from("nav_items").select("id, label, target, sort_order, is_visible").order("sort_order"),
    sb.from("site_sections").select("key, title, intro, is_visible, sort_order, item_limit, featured_ids, stat_value").order("sort_order"),
    pickVideos(sb),
    pickServices(sb),
    pickOffers(sb),
    pickAlbums(sb),
  ]);
  if (nav.error) return <CmsLoadError error={nav.error} what="القائمة" />;
  if (sec.error) return <CmsLoadError error={sec.error} what="الأقسام" />;
  const items = (nav.data ?? []) as Nav[];
  const sections = ((sec.data ?? []) as SectionRow[]).filter((s): s is SectionRow & { key: SectionKey } => (SECTION_KEYS as readonly string[]).includes(s.key));
  const opts: Record<NonNullable<(typeof SECTION_FEATURE)[SectionKey]>, Opt[]> = { video: videos, service: services, offer: offers, album: albums };

  return (
    <>
      <PageHeader title="القائمة والأقسام" back={{ href: "/admin/content", label: "محتوى الموقع" }} lead="غيّر أسماء روابط القائمة وترتيبها وإظهارها. عنوان كل صفحة (URL) ثابت ولا يتغير بتغيير الاسم." />
      <div className="space-y-6">
        <Card title="روابط القائمة العلوية">
          <p className="mb-3 text-sm text-on-cream-muted">صفحات الإدارة وتسجيل الدخول ليست ضمن القائمة ولا يمكن إضافتها هنا.</p>
          {items.length ? (
            <SortableList
              label="ترتيب روابط القائمة"
              table="nav_items"
              action={saveOrder}
              testId="nav-list"
              items={items.map((n) => ({
                id: n.id,
                content: (
                  <CmsForm action={saveNavItem} testId={`nav-${n.target}`} intents={[{ intent: "save", label: "حفظ", kind: "secondary" }]}>
                    <input type="hidden" name="id" value={n.id} />
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                      <Field label={`الاسم — يفتح ${isSiteTarget(n.target) ? PAGE_TARGET_LABEL[n.target] : n.target}`} hint={isSiteTarget(n.target) ? PAGE_TARGET_PATH(n.target) : undefined}>
                        <input name="label" required maxLength={30} defaultValue={n.label} className={inputCls} />
                      </Field>
                      <label className="flex min-h-10 items-center gap-2 text-sm">
                        <input type="checkbox" name="is_visible" defaultChecked={n.is_visible} /> ظاهر
                      </label>
                    </div>
                  </CmsForm>
                ),
              }))}
            />
          ) : (
            <Notice>لا توجد روابط. يعرض الموقع القائمة الافتراضية.</Notice>
          )}
        </Card>

        <Card title="أقسام الصفحة الرئيسية">
          <p className="mb-3 text-sm text-on-cream-muted">رتّب الأقسام وأظهرها أو أخفها. القسم بلا محتوى منشور لا يظهر حتى لو كان مفعّلاً.</p>
          <SortableList
            label="ترتيب أقسام الرئيسية"
            action={saveSectionOrder}
            testId="sections-order"
            items={sections.map((s) => ({
              id: s.key,
              content: (
                <div className="flex flex-wrap items-center gap-2" data-testid="section-row" data-key={s.key}>
                  <span className="min-w-0 flex-1 font-medium">{s.title || SECTION_LABEL[s.key]}</span>
                  <Badge>{SECTION_LABEL[s.key]}</Badge>
                  {s.is_visible ? <Badge tone="success">ظاهر</Badge> : <Badge>مخفي</Badge>}
                  <ActionForm action={setSectionVisible} submitLabel={s.is_visible ? "إخفاء" : "إظهار"} kind="ghost" inline>
                    <input type="hidden" name="key" value={s.key} />
                    <input type="hidden" name="value" value={s.is_visible ? "0" : "1"} />
                  </ActionForm>
                </div>
              ),
            }))}
          />
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {sections.map((s) => {
            const kind = SECTION_FEATURE[s.key];
            return (
              <Card key={s.key} title={SECTION_LABEL[s.key]} id={`section-${s.key}`}>
                <CmsForm action={saveSection} testId={`section-${s.key}`}>
                  <input type="hidden" name="key" value={s.key} />
                  <div className="grid gap-3">
                    <Field label="العنوان">
                      <input name="title" maxLength={120} defaultValue={s.title ?? ""} className={inputCls} />
                    </Field>
                    <Field label="المقدمة" hint={LONG_TEXT_HINT}>
                      <textarea name="intro" rows={2} maxLength={LONG_TEXT} defaultValue={s.intro ?? ""} className={inputCls} />
                    </Field>
                    {s.key === "stats" ? (
                      <Field label="الرقم" hint="العدد الحقيقي للحفلات والمناسبات اللي وثّقها الاستوديو. القسم ما بظهر بالموقع بدون رقم.">
                        <input name="stat_value" type="number" inputMode="numeric" min={1} max={10000000} step={1} defaultValue={s.stat_value ?? ""} className={inputCls} data-testid="stat-value" />
                      </Field>
                    ) : null}
                    <div className="grid grid-cols-2 gap-3">
                      {s.key === "stats" ? (
                        <input type="hidden" name="item_limit" value={s.item_limit} />
                      ) : (
                        <Field label="عدد العناصر" hint="من 1 إلى 12">
                          <input name="item_limit" type="number" inputMode="numeric" min={1} max={12} step={1} defaultValue={s.item_limit} className={inputCls} />
                        </Field>
                      )}
                      <label className="flex min-h-10 items-center gap-2 self-end text-sm">
                        <input type="checkbox" name="is_visible" defaultChecked={s.is_visible} /> ظاهر
                      </label>
                    </div>
                    {kind ? (
                      <CheckList
                        name="featured_ids"
                        legend={kind === "album" ? "ألبومات مختارة يدوياً" : "عناصر مميزة (تظهر أولاً)"}
                        options={opts[kind]}
                        selected={s.featured_ids ?? []}
                        max={12}
                      />
                    ) : null}
                    {kind === "album" ? (
                      <p className="text-sm text-muted" data-testid="albums-featured-note">
                        {(s.featured_ids ?? []).length
                          ? "أحدث ألبوم منشور يظهر أولاً دائماً، وبعده الألبومات اللي اخترتها بترتيبك، ثم الأحدث لتكملة العدد."
                          : "بدون اختيار: الرئيسية تعرض أحدث الألبومات المنشورة (حسب تاريخ النشر). صفحة الألبومات تعرض الأحدث نشراً دائماً."}
                      </p>
                    ) : null}
                  </div>
                </CmsForm>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
