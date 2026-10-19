import { createClient } from "@/lib/supabase/server";
import { Forbidden, guard, OWNER_ONLY } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, btn, Card, Field, FilterChips, inputCls, LoadError, PageHeader, Pagination, SearchBox, Table } from "@/features/admin/ui";
import { cleanSearch, one, pageOf, PAGE_SIZE, pick, rangeOf, type SP } from "@/features/admin/query";
import { fmtDate } from "@/features/admin/format";
import { ROLE_LABEL } from "@/features/admin/labels";
import { Constants } from "@/types/database";
import { createUserAccount, setUserDisabled, setUserRole, setUserPassword } from "./actions";

export async function UsersPage({ searchParams }: { searchParams: SP }) {
  const session = await guard(OWNER_ONLY);
  if (!session) return <Forbidden />;
  const sp = await searchParams;
  const role = pick(one(sp.role), Constants.public.Enums.app_role);
  const q = cleanSearch(one(sp.q));
  const page = pageOf(sp.page);
  const sb = await createClient();
  let query = sb.from("profiles").select("id, full_name, phone, role, disabled, mfa_required, created_at", { count: "exact" }).order("created_at", { ascending: false });
  if (role) query = query.eq("role", role);
  if (q) query = query.or(`full_name.ilike.*${q}*,phone.ilike.*${q}*`);
  const { data, count, error } = await query.range(...rangeOf(page));
  const params = { role: role ?? "", q };
  return (
    <>
      <PageHeader title="المستخدمون والصلاحيات" lead="أي تغيير هنا يسري فوراً ويُسجّل في سجل التدقيق." />
      <Card title="إنشاء حساب جديد" className="mb-6">
        <ActionForm action={createUserAccount} submitLabel="إنشاء الحساب" kind="primary" resetOnSuccess testId="create-account-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="الاسم">
              <input name="full_name" required minLength={2} maxLength={120} autoComplete="off" className={inputCls} />
            </Field>
            <Field label="الإيميل" hint="بيستعمله للدخول.">
              <input name="email" type="email" required dir="ltr" autoComplete="off" className={inputCls} />
            </Field>
            <Field label="الصلاحية" hint="مالك: كل شي. مدير: المحتوى والمناسبات. موظف: المناسبات المكلّف فيها. عميل: البوابة بس.">
              <select name="role" defaultValue="admin" className={inputCls}>
                {(["owner", "admin", "staff", "customer"] as const).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="hidden sm:block" />
            <Field label="كلمة السر" hint="10 أحرف على الأقل. ابعتها للشخص بطريقة آمنة.">
              <input name="password" type="password" required minLength={10} maxLength={72} autoComplete="new-password" className={inputCls} />
            </Field>
            <Field label="تأكيد كلمة السر">
              <input name="confirm" type="password" required minLength={10} maxLength={72} autoComplete="new-password" className={inputCls} />
            </Field>
          </div>
        </ActionForm>
      </Card>
      <FilterChips base="/admin/users" param="role" current={role ?? ""} params={params} options={Constants.public.Enums.app_role.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
      <SearchBox base="/admin/users" q={q} params={params} />
      {error ? <LoadError /> : (
        <>
          <Table head={["الاسم", "الهاتف", "الدور", "الحالة", "أُنشئ", "إجراءات"]} empty={!data?.length}>
            {data?.map((u) => {
              const self = u.id === session.userId;
              return (
                <tr key={u.id}>
                  <td>{u.full_name ?? "—"}{self ? <span className="ms-1 text-xs text-on-cream-muted">(أنت)</span> : null}</td>
                  <td dir="ltr" className="text-end">{u.phone ?? "—"}</td>
                  <td>
                    {self ? <Badge tone="ink">{ROLE_LABEL[u.role]}</Badge> : (
                      <ActionForm action={setUserRole} submitLabel="تغيير" kind="ghost" inline confirm={{ title: "تغيير دور هذا المستخدم؟", body: "يغيّر ما يمكنه رؤيته وتعديله فوراً." }}>
                        <input type="hidden" name="id" value={u.id} />
                        <select name="role" defaultValue={u.role} aria-label="الدور" className="field !min-h-9 !w-auto !py-1 text-sm">
                          {Constants.public.Enums.app_role.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      </ActionForm>
                    )}
                  </td>
                  <td>{u.disabled ? <Badge tone="danger">معطّل</Badge> : <Badge tone="success">فعّال</Badge>}{u.mfa_required ? <span className="ms-1"><Badge>تحقق بخطوتين</Badge></span> : null}</td>
                  <td>{fmtDate(u.created_at)}</td>
                  <td>
                    {self ? null : (
                      <div className="flex flex-wrap items-start gap-2">
                      <details className="group relative" data-testid="set-password">
                        <summary className={`${btn("ghost")} cursor-pointer list-none whitespace-nowrap [&::-webkit-details-marker]:hidden`}>تعيين كلمة سر</summary>
                        <div className="mt-2 w-72 max-w-full rounded-md border border-cream-line bg-cream p-3">
                          <ActionForm action={setUserPassword} submitLabel="حفظ كلمة السر" kind="primary" resetOnSuccess>
                            <input type="hidden" name="id" value={u.id} />
                            <Field label="كلمة السر الجديدة" hint="10 أحرف على الأقل.">
                              <input name="password" type="password" required minLength={10} maxLength={72} autoComplete="new-password" className={inputCls} />
                            </Field>
                            <Field label="تأكيد كلمة السر">
                              <input name="confirm" type="password" required minLength={10} maxLength={72} autoComplete="new-password" className={inputCls} />
                            </Field>
                          </ActionForm>
                        </div>
                      </details>
                      <ActionForm
                        action={setUserDisabled}
                        submitLabel={u.disabled ? "إعادة تفعيل" : "تعطيل"}
                        kind={u.disabled ? "ghost" : "danger"}
                        inline
                        confirm={u.disabled ? undefined : { title: "تعطيل هذا الحساب؟", body: "يفقد الوصول فوراً لكل البيانات. يمكن إعادة التفعيل لاحقاً.", confirmLabel: "تعطيل" }}
                      >
                        <input type="hidden" name="id" value={u.id} />
                        <input type="hidden" name="disabled" value={u.disabled ? "0" : "1"} />
                      </ActionForm>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
          <Pagination base="/admin/users" page={page} total={count ?? 0} size={PAGE_SIZE} params={params} />
        </>
      )}
    </>
  );
}
