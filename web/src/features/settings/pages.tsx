import { SettingsTabs } from "@/features/admin/SettingsTabs";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Card, LoadError, PageHeader } from "@/features/admin/ui";
import { MODULE_LABEL, MODULES } from "@/features/admin/nav";
import { saveAppSettings, saveEnabledModules } from "./actions";

export async function SettingsPage() {
  const session = await guard(ADMIN_ROLES);
  if (!session) return <Forbidden />;
  const isOwner = session.role === "owner";
  const sb = await createClient();
  // Studio details live in their own tab («بيانات النشاط والشعار»); this page holds the panel settings only.
  const app = isOwner
    ? await sb.from("app_settings").select("require_staff_mfa, turnstile_enabled, enabled_modules").eq("id", 1).maybeSingle()
    : { data: null, error: null };
  if (app.error) return <LoadError what="الإعدادات" />;
  return (
    <>
      <PageHeader title="الإعدادات" lead="أمان الدخول والأقسام اللي بتظهر بالقائمة. بيانات النشاط والشعار في تبويبها." />
      <SettingsTabs current="/admin/settings" />
      <div className="grid gap-4 lg:grid-cols-2">
        {!isOwner ? (
          <Card title="إعدادات النظام">
            <p className="text-sm text-on-cream-muted">أمان الدخول والأقسام المفعّلة وفيسبوك والنسخ الاحتياطي يعدّلها المالك فقط. بيانات النشاط والشعار وحسابك في التبويبات فوق.</p>
          </Card>
        ) : null}
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
