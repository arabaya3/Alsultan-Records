import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, DL, Field, FilterChips, inputCls, LoadError, Notice, PageHeader, Pagination, RowLink, Table } from "@/features/admin/ui";
import { one, pageOf, PAGE_SIZE, pick, rangeOf, type IdParams, type SP } from "@/features/admin/query";
import { fmtDate, fmtDateTime } from "@/features/admin/format";
import { formatMinor, minorToInput } from "@/features/admin/money";
import { CONTRACT_STATUS } from "@/features/admin/labels";
import { isUuid } from "@/features/admin/result";
import { Constants } from "@/types/database";
import { addContractVersion, sendContract, voidContract } from "./actions";

export async function ContractsList({ searchParams }: { searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sp = await searchParams;
  const status = pick(one(sp.status), Constants.public.Enums.contract_status);
  const page = pageOf(sp.page);
  const sb = await createClient();
  let query = sb
    .from("contracts")
    .select("id, status, created_at, approved_at, customers(full_name), events(title)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, count, error } = await query.range(...rangeOf(page));
  const params = { status: status ?? "" };
  return (
    <>
      <PageHeader title="العقود" lead="تُنشأ العقود من صفحة عرض السعر." />
      <FilterChips base="/admin/contracts" param="status" current={status ?? ""} params={params} options={Constants.public.Enums.contract_status.map((s) => ({ value: s, label: CONTRACT_STATUS[s] }))} />
      {error ? <LoadError /> : (
        <>
          <Table head={["العميل", "المناسبة", "أُنشئ", "اعتُمد", "الحالة"]} empty={!data?.length}>
            {data?.map((c) => (
              <tr key={c.id}>
                <td><RowLink href={`/admin/contracts/${c.id}`}>{c.customers?.full_name ?? "—"}</RowLink></td>
                <td>{c.events?.title ?? "—"}</td>
                <td>{fmtDate(c.created_at)}</td>
                <td>{fmtDate(c.approved_at)}</td>
                <td><Badge tone={c.status === "approved" ? "success" : c.status === "sent" ? "gold" : "neutral"}>{CONTRACT_STATUS[c.status]}</Badge></td>
              </tr>
            ))}
          </Table>
          <Pagination base="/admin/contracts" page={page} total={count ?? 0} size={PAGE_SIZE} params={params} />
        </>
      )}
    </>
  );
}

export async function ContractDetail({ params }: { params: IdParams }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sb = await createClient();
  const [c, versions] = await Promise.all([
    sb.from("contracts").select("id, status, quote_id, current_version_id, approved_version_id, approved_at, customers(full_name), events(title), quotes(quote_no)").eq("id", id).maybeSingle(),
    sb.from("contract_versions").select("id, version_no, body, currency, total, deposit_required, content_hash, created_at").eq("contract_id", id).order("version_no", { ascending: false }),
  ]);
  if (c.error) return <LoadError />;
  if (!c.data) notFound();
  const k = c.data;
  const current = versions.data?.find((v) => v.id === k.current_version_id);
  const approved = versions.data?.find((v) => v.id === k.approved_version_id);
  const editable = k.status === "draft" || k.status === "sent";

  return (
    <>
      <PageHeader
        title={`عقد · ${k.customers?.full_name ?? ""}`}
        lead={<>{k.events?.title ?? ""}{k.quotes ? <> · عرض <RowLink href={`/admin/quotes/${k.quote_id}`}>{k.quotes.quote_no}</RowLink></> : null}</>}
        back={{ href: "/admin/contracts", label: "العقود" }}
        actions={<Badge tone={k.status === "approved" ? "success" : k.status === "sent" ? "gold" : "neutral"}>{CONTRACT_STATUS[k.status]}</Badge>}
      />
      {approved ? (
        <div className="mb-4" data-testid="approved-version">
          <Notice tone="success">
            اعتمد العميل <strong>النسخة {approved.version_no}</strong> بتاريخ {fmtDateTime(k.approved_at)} · القيمة {formatMinor(approved.total, approved.currency)} ·
            بصمة النص <span dir="ltr" className="font-mono text-xs">{approved.content_hash.slice(0, 16)}…</span>
          </Notice>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          {versions.data?.map((v) => (
            <Card
              key={v.id}
              title={`النسخة ${v.version_no}`}
              actions={
                <span className="flex gap-2">
                  {v.id === k.current_version_id ? <Badge tone="gold">الحالية</Badge> : null}
                  {v.id === k.approved_version_id ? <Badge tone="success">المعتمدة</Badge> : null}
                </span>
              }
            >
              <DL items={[["القيمة", formatMinor(v.total, v.currency)], ["العربون", formatMinor(v.deposit_required, v.currency)], ["أُنشئت", fmtDateTime(v.created_at)], ["البصمة", <span key="h" dir="ltr" className="font-mono text-xs break-all">{v.content_hash}</span>]]} />
              <details className="mt-3">
                <summary className="cursor-pointer text-sm">النص الكامل</summary>
                <p className="mt-2 whitespace-pre-wrap rounded-sm bg-cream-2 p-3 text-sm">{v.body}</p>
              </details>
            </Card>
          ))}
        </div>
        <div className="space-y-4">
          <Card title="الإجراءات">
            <div className="flex flex-wrap gap-2">
              {k.status === "draft" && current ? (
                <ActionForm action={sendContract} submitLabel={`إرسال النسخة ${current.version_no} للعميل`} kind="primary" inline confirm={{ title: "إرسال العقد للعميل؟", body: "سيوافق العميل على هذه النسخة بالتحديد." }}>
                  <input type="hidden" name="id" value={k.id} />
                </ActionForm>
              ) : null}
              {k.status !== "void" ? (
                <ActionForm action={voidContract} submitLabel="إلغاء العقد" kind="danger" inline confirm={{ title: "إلغاء العقد؟", body: "تبقى النسخ محفوظة، ولا يمكن إعادة تفعيله.", confirmLabel: "إلغاء العقد" }}>
                  <input type="hidden" name="id" value={k.id} />
                </ActionForm>
              ) : null}
            </div>
          </Card>
          {editable ? (
            <Card title="نسخة جديدة">
              <p className="mb-2 text-xs text-on-cream-muted">النسخ السابقة لا تُعدّل أبداً. النسخة الجديدة تصبح الحالية، وإن كان العقد مُرسلاً يعود مسودة حتى تعيد إرساله.</p>
              <ActionForm action={addContractVersion} submitLabel="حفظ كنسخة جديدة">
                <input type="hidden" name="contract_id" value={k.id} />
                <Field label="النص"><textarea name="body" required minLength={10} rows={8} defaultValue={current?.body ?? ""} className={inputCls} /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="القيمة (₪)"><input name="total" required inputMode="decimal" dir="ltr" defaultValue={current ? minorToInput(current.total) : ""} className={inputCls} /></Field>
                  <Field label="العربون (₪)"><input name="deposit" inputMode="decimal" dir="ltr" defaultValue={current ? minorToInput(current.deposit_required) : "0"} className={inputCls} /></Field>
                </div>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
