import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, ALL_STAFF, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, btn, Card, Field, FilterChips, inputCls, LoadError, Notice, PageHeader, Pagination, RowLink, Table } from "@/features/admin/ui";
import { one, pageOf, PAGE_SIZE, pick, rangeOf, type IdParams, type SP } from "@/features/admin/query";
import { fmtDate, fmtDateTime, fmtTimecode, isoInDays } from "@/features/admin/format";
import { DELIVERABLE_KIND, DELIVERABLE_STATUS, SELECTION_STATUS } from "@/features/admin/labels";
import { isUuid } from "@/features/admin/result";
import { Constants, type Json } from "@/types/database";
import { addRevision, replyComment, setSelectionStatus, toggleComment, updateDeliverable } from "./production-actions";
import { signPaths, thumbPath } from "./signed";

export async function ProductionList({ searchParams }: { searchParams: SP }) {
  const session = await guard(ALL_STAFF);
  if (!session) return <Forbidden />;
  const sp = await searchParams;
  const status = pick(one(sp.status), Constants.public.Enums.deliverable_status);
  const dueSoon = one(sp.due) === "soon";
  const page = pageOf(sp.page);
  const sb = await createClient();
  let query = sb
    .from("deliverables")
    .select("id, title, kind, status, due_at, event_id, events(title)", { count: "exact" })
    .order("due_at", { ascending: true, nullsFirst: false });
  if (status) query = query.eq("status", status);
  if (dueSoon)
    query = query.not("status", "in", "(approved,delivered)").lte("due_at", isoInDays(3));
  const { data, count, error } = await query.range(...rangeOf(page));
  const params = { status: status ?? "", due: dueSoon ? "soon" : "" };
  const now = isoInDays(0);
  return (
    <>
      <PageHeader
        title="الإنتاج والتسليم"
        actions={
          <>
            <Link className={btn(dueSoon ? "secondary" : "ghost")} href={dueSoon ? "/admin/production" : "/admin/production?due=soon"}>
              {dueSoon ? "عرض الكل" : "المستحق خلال ٣ أيام"}
            </Link>
            {session.role !== "staff" ? <Link className={btn("ghost")} href="/admin/production/albums">اختيارات الألبوم</Link> : null}
          </>
        }
      />
      <FilterChips
        base="/admin/production"
        param="status"
        current={status ?? ""}
        params={params}
        options={Constants.public.Enums.deliverable_status.map((s) => ({ value: s, label: DELIVERABLE_STATUS[s] }))}
      />
      {error ? (
        <LoadError />
      ) : (
        <>
          <Table head={["التسليم", "المناسبة", "النوع", "الموعد", "الحالة"]} empty={!data?.length}>
            {data?.map((d) => (
              <tr key={d.id}>
                <td><RowLink href={`/admin/production/${d.id}`}>{d.title}</RowLink></td>
                <td><Link className="underline-offset-4 hover:underline" href={`/admin/events/${d.event_id}`}>{d.events?.title ?? "—"}</Link></td>
                <td>{DELIVERABLE_KIND[d.kind]}</td>
                <td className={d.due_at && d.due_at < now && !["approved", "delivered"].includes(d.status) ? "text-danger" : ""}>{fmtDate(d.due_at)}</td>
                <td><Badge tone={d.status === "revision_requested" ? "gold" : d.status === "delivered" ? "success" : "neutral"}>{DELIVERABLE_STATUS[d.status]}</Badge></td>
              </tr>
            ))}
          </Table>
          <Pagination base="/admin/production" page={page} total={count ?? 0} size={PAGE_SIZE} params={params} />
        </>
      )}
    </>
  );
}

export async function DeliverableDetail({ params }: { params: IdParams }) {
  const session = await guard(ALL_STAFF);
  if (!session) return <Forbidden />;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sb = await createClient();
  const d = await sb.from("deliverables").select("id, event_id, kind, title, status, due_at, events(title)").eq("id", id).maybeSingle();
  if (d.error) return <LoadError />;
  if (!d.data) notFound();
  const del = d.data;
  const [revs, media, requests] = await Promise.all([
    sb
      .from("deliverable_revisions")
      .select("id, revision_no, notes, created_at, media_asset_id, media_assets(id, mime, kind, path), video_comments(id, timecode_ms, body, resolved, created_at, author_id)")
      .eq("deliverable_id", id)
      .order("revision_no", { ascending: false }),
    sb
      .from("media_assets")
      .select("id, kind, mime, path, created_at")
      .eq("event_id", del.event_id)
      .eq("bucket", "private-media")
      .eq("upload_status", "ready")
      .in("kind", del.kind === "video" ? ["video"] : ["video", "image", "document"])
      .order("created_at", { ascending: false })
      .limit(100),
    sb
      .from("notifications")
      .select("id, payload, created_at")
      .eq("kind", "revision_requested")
      .contains("payload", { deliverable_id: id })
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const revisionNotes = (requests.data ?? []).map((n) => {
    const p = n.payload as { note?: Json };
    return { id: n.id, at: n.created_at, note: typeof p?.note === "string" ? p.note : "" };
  });

  return (
    <>
      <PageHeader
        title={del.title}
        lead={<><Link className="underline underline-offset-4" href={`/admin/events/${del.event_id}`}>{del.events?.title}</Link> · {DELIVERABLE_KIND[del.kind]}</>}
        back={{ href: "/admin/production", label: "الإنتاج" }}
        actions={<Badge tone={del.status === "revision_requested" ? "gold" : "neutral"}>{DELIVERABLE_STATUS[del.status]}</Badge>}
      />
      {del.status === "revision_requested" || revisionNotes.length ? (
        <div className="mb-4">
          <Notice tone="gold">
            <p className="font-medium">طلبات التعديل من العميل</p>
            <ul className="mt-1 space-y-1">
              {revisionNotes.map((r) => (
                <li key={r.id}><span className="text-on-cream-muted">{fmtDateTime(r.at)}:</span> {r.note}</li>
              ))}
              {!revisionNotes.length ? <li>طلب العميل تعديلاً (التفاصيل في التعليقات على النسخة).</li> : null}
            </ul>
          </Notice>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
        <div className="space-y-4">
          <Card title="الحالة والموعد">
            <ActionForm action={updateDeliverable} submitLabel="حفظ">
              <input type="hidden" name="id" value={del.id} />
              <Field label="العنوان"><input name="title" maxLength={200} defaultValue={del.title} className={inputCls} /></Field>
              <Field label="الحالة" hint="«بانتظار مراجعة العميل» يتيح للعميل طلب تعديل من البوابة.">
                <select name="status" defaultValue={del.status} className={inputCls}>
                  {Constants.public.Enums.deliverable_status.map((s) => (
                    <option key={s} value={s}>{DELIVERABLE_STATUS[s]}</option>
                  ))}
                </select>
              </Field>
              <Field label="موعد التسليم"><input name="due_at" type="date" defaultValue={del.due_at?.slice(0, 10) ?? ""} className={inputCls} /></Field>
            </ActionForm>
          </Card>
          <Card title="إضافة نسخة جديدة">
            <ActionForm action={addRevision} submitLabel="إضافة النسخة" kind="primary" resetOnSuccess>
              <input type="hidden" name="deliverable_id" value={del.id} />
              <Field label={del.kind === "video" ? "ملف الفيديو" : "الملف (اختياري)"} hint="ارفع الملف أولاً من صفحة وسائط المناسبة.">
                <select name="media_asset_id" required={del.kind === "video"} className={inputCls}>
                  {del.kind !== "video" ? <option value="">بدون ملف</option> : null}
                  {media.data?.map((m) => (
                    <option key={m.id} value={m.id}>{m.path.split("/").pop()} · {fmtDate(m.created_at)}</option>
                  ))}
                </select>
              </Field>
              <Field label="ملاحظات النسخة"><textarea name="notes" rows={2} maxLength={4000} className={inputCls} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="send_review" defaultChecked /> إرسالها لمراجعة العميل</label>
            </ActionForm>
          </Card>
        </div>
        <div className="space-y-4">
          {revs.data?.map((r) => {
            const comments = [...(r.video_comments ?? [])].sort((a, b) => a.timecode_ms - b.timecode_ms);
            return (
              <Card key={r.id} title={`النسخة ${r.revision_no}`} actions={<span className="text-xs text-on-cream-muted">{fmtDateTime(r.created_at)}</span>}>
                {r.notes ? <p className="mb-2 whitespace-pre-wrap text-sm">{r.notes}</p> : null}
                <p className="mb-3 text-xs text-on-cream-muted">{r.media_assets ? `الملف: ${r.media_assets.path.split("/").pop()}` : "بدون ملف"}</p>
                <h3 className="mb-1 text-sm font-medium">تعليقات الفيديو ({comments.length})</h3>
                <ul className="mb-3 divide-y divide-cream-line text-sm">
                  {comments.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                      <span className={c.resolved ? "text-on-cream-muted line-through" : ""}>
                        <span dir="ltr" className="me-2 rounded-sm bg-ink px-1.5 py-0.5 font-mono text-xs text-on-dark">{fmtTimecode(c.timecode_ms)}</span>
                        {c.body}
                      </span>
                      <ActionForm action={toggleComment} submitLabel={c.resolved ? "إعادة فتح" : "تم"} kind="ghost" inline>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="resolved" value={c.resolved ? "0" : "1"} />
                      </ActionForm>
                    </li>
                  ))}
                  {!comments.length ? <li className="py-2 text-on-cream-muted">لا تعليقات.</li> : null}
                </ul>
                <ActionForm action={replyComment} submitLabel="إضافة تعليق" kind="ghost" resetOnSuccess>
                  <input type="hidden" name="revision_id" value={r.id} />
                  <div className="grid grid-cols-[6rem_1fr] gap-2">
                    <input name="timecode" placeholder="0:00" dir="ltr" pattern="\d{1,2}:\d{2}" aria-label="التوقيت" className={inputCls} />
                    <input name="body" required maxLength={4000} aria-label="التعليق" className={inputCls} />
                  </div>
                </ActionForm>
              </Card>
            );
          })}
          {!revs.data?.length ? <p className="text-sm text-on-cream-muted">لا توجد نسخ بعد.</p> : null}
        </div>
      </div>
    </>
  );
}

export async function AlbumsList({ searchParams }: { searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sp = await searchParams;
  const page = pageOf(sp.page);
  const sb = await createClient();
  const { data, count, error } = await sb
    .from("album_selection_snapshots")
    .select("id, item_count, submitted_at, event_id, selection_id, events(title), album_selections(status)", { count: "exact" })
    .order("submitted_at", { ascending: false })
    .range(...rangeOf(page));
  return (
    <>
      <PageHeader title="اختيارات الألبوم" lead="كل إرسال من العميل محفوظ كنسخة ثابتة لا تتغير." back={{ href: "/admin/production", label: "الإنتاج" }} />
      {error ? (
        <LoadError />
      ) : (
        <>
          <Table head={["المناسبة", "عدد الصور", "أُرسلت", "حالة الاختيار"]} empty={!data?.length}>
            {data?.map((s) => (
              <tr key={s.id}>
                <td><RowLink href={`/admin/production/albums/${s.id}`}>{s.events?.title ?? "—"}</RowLink></td>
                <td>{s.item_count}</td>
                <td>{fmtDateTime(s.submitted_at)}</td>
                <td><Badge>{s.album_selections ? SELECTION_STATUS[s.album_selections.status] : "—"}</Badge></td>
              </tr>
            ))}
          </Table>
          <Pagination base="/admin/production/albums" page={page} total={count ?? 0} size={PAGE_SIZE} params={{}} />
        </>
      )}
    </>
  );
}

export async function AlbumSnapshot({ params }: { params: IdParams }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sb = await createClient();
  const s = await sb
    .from("album_selection_snapshots")
    .select("id, items, item_count, submitted_at, event_id, selection_id, events(title), album_selections(id, status)")
    .eq("id", id)
    .maybeSingle();
  if (s.error) return <LoadError />;
  if (!s.data) notFound();
  const snap = s.data;
  const items = (Array.isArray(snap.items) ? snap.items : []) as { media_asset_id?: string; note?: string | null }[];
  const ids = items.map((i) => i.media_asset_id).filter(isUuid);
  const assets = ids.length
    ? await sb.from("media_assets").select("id, path, variants").in("id", ids.slice(0, 500))
    : { data: [] as { id: string; path: string; variants: Json }[] };
  const pathById = new Map((assets.data ?? []).map((a) => [a.id, thumbPath(a.variants, a.path)]));
  const urls = await signPaths(sb, [...pathById.values()]);
  const sel = snap.album_selections;

  return (
    <>
      <PageHeader
        title={`اختيار ألبوم · ${snap.events?.title ?? ""}`}
        lead={`${snap.item_count} صورة · أُرسل ${fmtDateTime(snap.submitted_at)}`}
        back={{ href: "/admin/production/albums", label: "اختيارات الألبوم" }}
        actions={
          sel ? (
            <>
              <Badge>{SELECTION_STATUS[sel.status]}</Badge>
              {sel.status === "submitted" ? (
                <ActionForm action={setSelectionStatus} submitLabel="قفل الاختيار" inline>
                  <input type="hidden" name="id" value={sel.id} />
                  <input type="hidden" name="status" value="locked" />
                </ActionForm>
              ) : null}
            </>
          ) : null
        }
      />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {items.map((it, i) => {
          const p = it.media_asset_id ? pathById.get(it.media_asset_id) : undefined;
          const url = p ? urls.get(p) : undefined;
          return (
            <li key={`${it.media_asset_id}-${i}`} className="overflow-hidden rounded-md border border-cream-line bg-[#fffdf8] text-xs">
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img src={url} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              ) : (
                <div className="grid aspect-square place-items-center bg-cream-2 text-on-cream-muted">لا معاينة</div>
              )}
              <p className="p-1.5">{i + 1}{it.note ? ` · ${it.note}` : ""}</p>
            </li>
          );
        })}
      </ul>
    </>
  );
}
