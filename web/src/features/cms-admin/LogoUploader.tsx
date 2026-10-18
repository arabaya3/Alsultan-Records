"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import type { ActionResult } from "@/features/admin/result";
import { finalizeLogo, logoUploadUrl } from "./actions";

const MIME = ["image/png", "image/webp", "image/jpeg"];

/** Logo upload: signed URL -> direct upload to private site-media -> server validates with sharp. Never activates. */
export function LogoUploader() {
  const ref = useRef<HTMLFormElement>(null);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
    const note = (form.elements.namedItem("note") as HTMLInputElement).value;
    if (!file) return setMsg({ ok: false, message: "اختر ملف الشعار." });
    if (!MIME.includes(file.type)) return setMsg({ ok: false, message: "الصيغ المسموحة: PNG أو WebP أو JPEG (SVG غير مسموح)." });
    if (file.size > 2 * 1024 * 1024) return setMsg({ ok: false, message: "حجم الملف أكبر من 2 ميغابايت." });
    start(async () => {
      const fd = new FormData();
      fd.set("mime", file.type);
      fd.set("size", String(file.size));
      const s = await logoUploadUrl({ ok: true, message: "" }, fd);
      if (!s.ok || !s.data) return setMsg(s);
      const path = String(s.data.path);
      const up = await createClient().storage.from("site-media").uploadToSignedUrl(path, String(s.data.token), file, { contentType: file.type });
      if (up.error) return setMsg({ ok: false, message: "تعذّر رفع الملف. تحقق من الاتصال وحاول مرة أخرى." });
      const f = new FormData();
      f.set("path", path);
      f.set("note", note);
      const r = await finalizeLogo({ ok: true, message: "" }, f);
      setMsg(r);
      if (r.ok) {
        ref.current?.reset();
        router.refresh();
      }
    });
  }

  return (
    <form ref={ref} onSubmit={submit} className="space-y-3" data-testid="logo-upload">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">ملف الشعار</span>
        <input type="file" name="file" required accept="image/png,image/webp,image/jpeg" className="block w-full text-sm" />
        <span className="mt-1 block text-xs text-on-cream-muted">
          PNG أو WebP أو JPEG، حتى 2 ميغابايت، من 256×256 إلى 4000×4000 بكسل. يُفضّل خلفية شفافة. لا يتغير الشعار في الموقع حتى تضغط «تفعيل».
        </span>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">ملاحظة (اختياري)</span>
        <input name="note" maxLength={200} className="field !min-h-10 !py-1.5 text-sm" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="inline-flex min-h-10 items-center rounded-sm bg-ink px-4 text-sm font-medium text-on-dark hover:bg-ink-2 disabled:opacity-50">
          {pending ? "جارٍ الرفع…" : "رفع شعار جديد"}
        </button>
        {msg?.message ? (
          <p role={msg.ok ? "status" : "alert"} data-testid="action-msg" data-ok={msg.ok ? "1" : "0"} className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>
            {msg.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
