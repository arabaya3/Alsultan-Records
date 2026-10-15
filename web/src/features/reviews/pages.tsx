import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, FilterChips, LoadError, PageHeader, Pagination } from "@/features/admin/ui";
import { one, pageOf, PAGE_SIZE, pick, rangeOf, type SP } from "@/features/admin/query";
import { fmtDate } from "@/features/admin/format";
import { REVIEW_STATUS } from "@/features/admin/labels";
import { Constants } from "@/types/database";
import { moderateReviews } from "./actions";

export async function ReviewsPage({ searchParams }: { searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sp = await searchParams;
  const status = pick(one(sp.status), Constants.public.Enums.review_status);
  const page = pageOf(sp.page);
  const sb = await createClient();
  let q = sb.from("reviews").select("id, display_name, rating, body, status, created_at, customers(full_name), events(title)", { count: "exact" }).order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, count, error } = await q.range(...rangeOf(page));
  const params = { status: status ?? "" };
  return (
    <>
      <PageHeader title="التقييمات" lead="لا يظهر للعامة إلا ما تنشره هنا." />
      <FilterChips base="/admin/reviews" param="status" current={status ?? ""} params={params} options={Constants.public.Enums.review_status.map((s) => ({ value: s, label: REVIEW_STATUS[s] }))} />
      {error ? <LoadError /> : (
        <>
          <div className="mb-3">
            <ActionForm id="rev-bulk" action={moderateReviews} submitLabel="تطبيق على المحدد" inline>
              <select name="status" defaultValue="approved" aria-label="الإجراء" className="field !min-h-10 !py-1.5 text-sm !w-auto">
                <option value="approved">نشر</option>
                <option value="rejected">رفض</option>
                <option value="pending">إعادة للمراجعة</option>
              </select>
            </ActionForm>
          </div>
          <ul className="space-y-3">
            {data?.map((r) => (
              <li key={r.id} className="rounded-md border border-cream-line bg-[#fffdf8] p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 font-medium">
                    <input type="checkbox" name="ids" value={r.id} form="rev-bulk" aria-label="تحديد" />
                    {r.display_name ?? r.customers?.full_name ?? "عميل"} · <span dir="ltr">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
                  </label>
                  <span className="flex items-center gap-2 text-on-cream-muted">
                    {r.events?.title ? `${r.events.title} · ` : ""}{fmtDate(r.created_at)}
                    <Badge tone={r.status === "approved" ? "success" : r.status === "rejected" ? "danger" : "gold"}>{REVIEW_STATUS[r.status]}</Badge>
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap">{r.body}</p>
                <div className="mt-2 flex gap-2">
                  {r.status !== "approved" ? (
                    <ActionForm action={moderateReviews} submitLabel="نشر" kind="ghost" inline>
                      <input type="hidden" name="ids" value={r.id} /><input type="hidden" name="status" value="approved" />
                    </ActionForm>
                  ) : null}
                  {r.status !== "rejected" ? (
                    <ActionForm action={moderateReviews} submitLabel="رفض" kind="ghost" inline>
                      <input type="hidden" name="ids" value={r.id} /><input type="hidden" name="status" value="rejected" />
                    </ActionForm>
                  ) : null}
                </div>
              </li>
            ))}
            {!data?.length ? <li className="text-sm text-on-cream-muted">لا توجد تقييمات.</li> : null}
          </ul>
          <Pagination base="/admin/reviews" page={page} total={count ?? 0} size={PAGE_SIZE} params={params} />
        </>
      )}
    </>
  );
}
