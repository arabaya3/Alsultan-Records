import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { Forbidden, guard, OWNER_ONLY } from "@/features/admin/guard";
import { Badge, Card, Notice, PageHeader, Table } from "@/features/admin/ui";
import { dateAr } from "@/features/portal/format";

type Conn = { page_id: string; page_name: string; status: "connected" | "expired" | "disconnected"; graph_version: string; status_changed_at: string; last_error: string | null };
type Post = { id: string; status: string; page_name: string | null; meta_post_id: string | null; attempts: number; last_error: string | null; created_at: string };

const STATUS: Record<string, { label: string; tone?: "success" | "danger" }> = {
  awaiting_connection: { label: "بانتظار الربط" },
  queued: { label: "في الانتظار" },
  publishing: { label: "جارٍ الرفع" },
  processing: { label: "أُرسل — بانتظار تأكيد فيسبوك" },
  page_changed: { label: "الصفحة تغيّرت — يحتاج تأكيدك", tone: "danger" },
  published: { label: "منشور", tone: "success" },
  failed: { label: "فشل", tone: "danger" },
};

/**
 * Owner-only: the Facebook Page link and the «also post to Facebook» queue (migration 0027). Read-only here.
 * Connecting needs a Meta App + Facebook Login with the owner's own account (never a password, never a token
 * pasted into the browser); until that is set up this page says «غير مربوط» and explains the steps.
 */
export async function FacebookSettingsPage() {
  if (!(await guard(OWNER_ONLY))) return <Forbidden />;
  const sb = (await createClient()) as unknown as SupabaseClient;
  const [conn, posts] = await Promise.all([
    sb.from("meta_page_connection").select("page_id, page_name, status, graph_version, status_changed_at, last_error").eq("id", 1).maybeSingle(),
    sb.from("facebook_reel_posts").select("id, status, page_name, meta_post_id, attempts, last_error, created_at").order("created_at", { ascending: false }).limit(50),
  ]);
  const c = (conn.data ?? null) as Conn | null;
  const rows = (posts.data ?? []) as Post[];
  const connected = c?.status === "connected";
  return (
    <>
      <PageHeader title="صفحة فيسبوك" back={{ href: "/admin/settings", label: "الإعدادات" }} lead="نشر مقاطع الريلز على صفحة السلطان في فيسبوك — اختياري لكل مقطع، ومش مفعّل افتراضياً." />
      <Card title="حالة الربط">
        <div data-testid="facebook-connection" data-status={c?.status ?? "none"} className="space-y-2 text-sm">
          {connected ? (
            <p>
              <Badge tone="success">مربوط</Badge> الصفحة: <strong>{c!.page_name}</strong> · منذ {dateAr(c!.status_changed_at)}
            </p>
          ) : c?.status === "expired" ? (
            <p>
              <Badge tone="danger">انتهى الربط</Badge> الصفحة {c.page_name}. انتهت صلاحية الإذن أو سُحب؛ المقاطع المنتظرة لن تُنشر حتى تعيد الربط. ما نُشر قبل يبقى على فيسبوك.
            </p>
          ) : (
            <p>
              <Badge>غير مربوط</Badge> ما في صفحة فيسبوك مربوطة بالموقع. نشر المقاطع في الموقع يعمل عادي؛ خيار «انشر على فيسبوك أيضاً» ينتظر الربط.
            </p>
          )}
          <Notice>
            الربط يتم بتسجيل الدخول بحساب فيسبوك الخاص بك عبر تطبيق Meta رسمي. الموقع لا يطلب كلمة سر فيسبوك أبداً، ورمز الوصول يُحفظ على الخادم فقط.
            فصل الربط أو حذف مقطع من الموقع لا يحذف أي منشور من فيسبوك.
          </Notice>
        </div>
      </Card>
      <Card title="طلبات النشر على فيسبوك">
        <Table head={["التاريخ", "الصفحة", "الحالة", "ملاحظة"]} empty={!rows.length} label="طلبات النشر">
          {rows.map((p) => (
            <tr key={p.id} data-testid="facebook-post-row" data-status={p.status}>
              <td className="px-3 py-2 text-sm">{dateAr(p.created_at)}</td>
              <td className="px-3 py-2 text-sm">{p.page_name ?? "—"}</td>
              <td className="px-3 py-2">
                <Badge tone={STATUS[p.status]?.tone}>{STATUS[p.status]?.label ?? p.status}</Badge>
              </td>
              <td className="px-3 py-2 text-xs">{p.last_error ?? (p.status === "published" && p.meta_post_id ? `منشور فيسبوك: ${p.meta_post_id}` : "")}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
