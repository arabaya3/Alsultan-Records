import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import Link from "next/link";
import { Card, LoadError, PageHeader } from "@/features/admin/ui";
import { MODULE_LABEL, MODULES } from "@/features/admin/nav";
import { saveAppSettings, saveEnabledModules } from "./actions";

export async function SettingsPage() {
  const session = await guard(ADMIN_ROLES);
  if (!session) return <Forbidden />;
  const isOwner = session.role === "owner";
  const sb = await createClient();
  const [biz, app] = await Promise.all([
    sb.from("business_settings").select("name, phone, whatsapp, email, address").eq("id", 1).maybeSingle(),
    isOwner ? sb.from("app_settings").select("require_staff_mfa, turnstile_enabled, enabled_modules").eq("id", 1).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (biz.error || !biz.data) return <LoadError what="الإعدادات" />;
  const b = biz.data;
  const summary: [string, string | null, boolean][] = [
    ["اسم النشاط", b.name, false],
    ["الهاتف", b.phone, true],
    ["واتساب", b.whatsapp, true],
    ["البريد", b.email, true],
    ["العنوان", b.address, false],
  ];
  return (
    <>
      <PageHeader title="إعدادات اللوحة" lead="أمان الدخول والأقسام اللي بتظهر بالقائمة. بيانات النشاط تُعدَّل من «الهوية ومعلومات النشاط»." />
      <div className="grid gap-4 lg:grid-cols-2">
        {/* One place to edit the studio's details (same columns, same validation): «الهوية ومعلومات النشاط». */}
        <Card title="بيانات النشاط (تظهر في الموقع العام)">
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]" data-testid="settings-business-summary">
            {summary.map(([label, value, ltr]) => (
              <div key={label} className="contents">
                <dt className="font-medium text-on-cream-muted">{label}</dt>
                <dd dir={ltr && value ? "ltr" : undefined} className="min-w-0 break-words sm:text-start">
                  {value || "—"}
                </dd>
              </div>
            ))}
          </dl>
          <Link
            href="/admin/content/identity"
            data-testid="settings-edit-identity"
            className="mt-4 inline-flex min-h-11 items-center rounded-sm border border-gold px-4 text-sm font-medium hover:bg-gold/15"
          >
            تعديل بيانات النشاط في «الهوية ومعلومات النشاط»
          </Link>
          <p className="mt-2 text-xs text-on-cream-muted">عنوان الموقع في الروابط والبحث يأتي من إعداد الاستضافة (NEXT_PUBLIC_SITE_URL)، لا من هنا.</p>
        </Card>
        {isOwner && app.data ? (
          <Card title="إعدادات النظام (المالك فقط)">
            <ActionForm action={saveAppSettings} submitLabel="حفظ الإعدادات" confirm={{ title: "حفظ إعدادات النظام؟", body: "تؤثر على أمان الدخول ونماذج الحجز لكل المستخدمين." }}>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="require_staff_mfa" defaultChecked={app.data.require_staff_mfa} /> إلزام الطاقم والإدارة بالتحقق بخطوتين</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="turnstile_enabled" defaultChecked={app.data.turnstile_enabled} /> حماية النماذج العامة من الرسائل الآلية</label>
            </ActionForm>
          </Card>
        ) : null}
        {isOwner && app.data ? (
          <Card title="الأقسام المفعّلة">
            <ActionForm action={saveEnabledModules} submitLabel="حفظ الأقسام">
              <p className="text-sm text-on-cream-muted">
                الأقسام غير المفعّلة بتختفي من القائمة بس؛ بياناتها بتضل محفوظة وبترجع لما تفعّلها.
              </p>
              <fieldset data-testid="enabled-modules">
                <legend className="sr-only">الأقسام المفعّلة في «شغل المناسبات»</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {MODULES.map((m) => (
                    <label key={m} className="flex min-h-10 items-center gap-2 text-sm">
                      <input type="checkbox" name="modules" value={m} defaultChecked={(app.data?.enabled_modules ?? []).includes(m)} /> {MODULE_LABEL[m]}
                    </label>
                  ))}
                </div>
              </fieldset>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
