import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Card, Field, inputCls, LoadError, PageHeader } from "@/features/admin/ui";
import { saveAppSettings, saveBusinessSettings } from "./actions";

export async function SettingsPage() {
  const session = await guard(ADMIN_ROLES);
  if (!session) return <Forbidden />;
  const isOwner = session.role === "owner";
  const sb = await createClient();
  const [biz, app] = await Promise.all([
    sb.from("business_settings").select("name, tagline, phone, whatsapp, email, address, instagram, facebook, youtube_url, whatsapp_url, canonical_base_url").eq("id", 1).maybeSingle(),
    isOwner ? sb.from("app_settings").select("require_staff_mfa, turnstile_enabled, booking_rules").eq("id", 1).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (biz.error || !biz.data) return <LoadError what="الإعدادات" />;
  const b = biz.data;
  const text = (name: keyof typeof b, label: string, ltr = false) => (
    <Field label={label}><input name={name} dir={ltr ? "ltr" : undefined} defaultValue={(b[name] as string | null) ?? ""} className={inputCls} /></Field>
  );
  return (
    <>
      <PageHeader title="الإعدادات" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="بيانات النشاط (تظهر في الموقع العام)">
          <ActionForm action={saveBusinessSettings} submitLabel="حفظ">
            <div className="grid gap-3 sm:grid-cols-2">
              {text("name", "اسم النشاط")}
              {text("tagline", "الشعار")}
              {text("phone", "الهاتف", true)}
              {text("whatsapp", "واتساب", true)}
              {text("email", "البريد", true)}
              {text("address", "العنوان")}
              {text("instagram", "رابط إنستغرام", true)}
              {text("facebook", "رابط فيسبوك", true)}
              {text("youtube_url", "رابط قناة يوتيوب", true)}
              {text("whatsapp_url", "رابط واتساب (wa.me)", true)}
              {text("canonical_base_url", "عنوان الموقع الأساسي", true)}
            </div>
          </ActionForm>
        </Card>
        {isOwner && app.data ? (
          <Card title="إعدادات النظام (المالك فقط)">
            <ActionForm action={saveAppSettings} submitLabel="حفظ" confirm={{ title: "حفظ إعدادات النظام؟", body: "تؤثر على أمان الدخول ونماذج الحجز لكل المستخدمين." }}>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="require_staff_mfa" defaultChecked={app.data.require_staff_mfa} /> إلزام الطاقم والإدارة بالتحقق بخطوتين</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="turnstile_enabled" defaultChecked={app.data.turnstile_enabled} /> حماية النماذج العامة من الرسائل الآلية</label>
              <Field label="قواعد الحجز (JSON)" hint="للاستخدام التقني؛ اتركها كما هي إن لم تكن متأكداً.">
                <textarea name="booking_rules" rows={5} dir="ltr" defaultValue={JSON.stringify(app.data.booking_rules ?? {}, null, 2)} className={`${inputCls} font-mono`} />
              </Field>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
