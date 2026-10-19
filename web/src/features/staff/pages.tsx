import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, Field, inputCls, LoadError, PageHeader } from "@/features/admin/ui";
import { ROLE_LABEL } from "@/features/admin/labels";
import { todayISO } from "@/features/admin/format";
import { saveStaff } from "./actions";

type Staff = { id: string; full_name: string; specialty: string | null; phone: string | null; active: boolean; profile_id: string | null };
type Profile = { id: string; full_name: string | null; role: "owner" | "admin" | "staff" | "customer" };

function StaffFields({ s, profiles }: { s?: Staff; profiles: Profile[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {s ? <input type="hidden" name="id" value={s.id} /> : null}
      <Field label="الاسم"><input name="full_name" required maxLength={200} defaultValue={s?.full_name} className={inputCls} /></Field>
      <Field label="التخصص"><input name="specialty" maxLength={120} defaultValue={s?.specialty ?? ""} className={inputCls} /></Field>
      <Field label="الهاتف"><input name="phone" dir="ltr" maxLength={32} defaultValue={s?.phone ?? ""} className={inputCls} /></Field>
      <Field label="حساب الدخول" hint="يربط الشخص بحسابه ليرى مناسباته فقط.">
        <select name="profile_id" defaultValue={s?.profile_id ?? ""} className={inputCls}>
          <option value="">بدون حساب</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name ?? p.id.slice(0, 8)} · {ROLE_LABEL[p.role]}</option>)}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={s ? s.active : true} /> نشط</label>
    </div>
  );
}

export async function StaffPage() {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sb = await createClient();
  const [staff, profiles, upcoming] = await Promise.all([
    sb.from("staff_members").select("id, full_name, specialty, phone, active, profile_id").order("active", { ascending: false }).order("full_name").limit(200),
    sb.from("profiles").select("id, full_name, role").in("role", ["owner", "admin", "staff"]).order("full_name"),
    sb.from("event_staff_assignments").select("staff_id, events!inner(event_date)").gte("events.event_date", todayISO()),
  ]);
  if (staff.error) return <LoadError what="الطاقم" />;
  const counts = new Map<string, number>();
  for (const a of upcoming.data ?? []) counts.set(a.staff_id, (counts.get(a.staff_id) ?? 0) + 1);
  return (
    <>
      <PageHeader title="الطاقم" lead="التكليف بالمناسبات يتم من صفحة كل مناسبة." />
      <div className="grid gap-4 lg:grid-cols-2">
        {staff.data?.map((s) => (
          <Card key={s.id} title={s.full_name} actions={<span className="flex gap-2">{s.active ? <Badge tone="success">نشط</Badge> : <Badge>متوقف</Badge>}<Badge>{counts.get(s.id) ?? 0} مناسبة قادمة</Badge></span>}>
            <ActionForm action={saveStaff} submitLabel="حفظ">
              <StaffFields s={s} profiles={profiles.data ?? []} />
            </ActionForm>
          </Card>
        ))}
        <Card title="إضافة عضو طاقم">
          <ActionForm action={saveStaff} submitLabel="إضافة" kind="primary" resetOnSuccess>
            <StaffFields profiles={profiles.data ?? []} />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
