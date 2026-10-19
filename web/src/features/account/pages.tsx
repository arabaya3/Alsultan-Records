import { ALL_STAFF, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Card, DL, Field, inputCls, PageHeader } from "@/features/admin/ui";
import { ROLE_LABEL } from "@/features/admin/labels";
import { changeOwnPassword } from "@/features/users/actions";

export async function AccountPage() {
  const session = await guard(ALL_STAFF);
  if (!session) return <Forbidden />;
  return (
    <>
      <PageHeader title="حسابي" lead="بياناتك وكلمة السر." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="بيانات الحساب">
          <DL
            items={[
              ["الاسم", session.fullName ?? "—"],
              ["الإيميل", <span key="e" dir="ltr">{session.email ?? "—"}</span>],
              ["الصلاحية", ROLE_LABEL[session.role]],
            ]}
          />
        </Card>
        <Card title="تغيير كلمة السر">
          <ActionForm action={changeOwnPassword} submitLabel="تغيير كلمة السر" kind="primary" resetOnSuccess testId="change-password-form">
            <div className="grid gap-3">
              <Field label="كلمة السر الحالية">
                <input name="current" type="password" required autoComplete="current-password" className={inputCls} />
              </Field>
              <Field label="كلمة السر الجديدة" hint="10 أحرف على الأقل.">
                <input name="password" type="password" required minLength={10} maxLength={72} autoComplete="new-password" className={inputCls} />
              </Field>
              <Field label="تأكيد كلمة السر الجديدة">
                <input name="confirm" type="password" required minLength={10} maxLength={72} autoComplete="new-password" className={inputCls} />
              </Field>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
