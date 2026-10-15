import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/States";
import { LoginForm, MfaForm } from "@/features/auth/components/AuthForms";
import { safeNext } from "@/features/auth/redirect";
import { getSessionProfile, STAFF_ROLES } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "تسجيل الدخول" };

const NOTICES: Record<string, string> = {
  disabled: "هذا الحساب موقوف. تواصل مع الاستوديو للمساعدة.",
  link: "انتهت صلاحية الرابط أو استُخدم من قبل. اطلب رابطاً جديداً.",
};

async function LoginContent({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const next = one(sp.next);
  const step = one(sp.step);
  const session = await getSessionProfile();

  if (step === "mfa") {
    if (!session) redirect(`/login?next=${encodeURIComponent(safeNext(next, null))}`);
    const supabase = await createClient();
    const { data } = await supabase.auth.mfa.listFactors();
    return (
      <>
        <h1 className="mb-2 text-3xl font-bold">التحقق بخطوتين</h1>
        <p className="mb-8 text-on-cream-muted">أدخل الرمز من تطبيق المصادقة لإكمال الدخول.</p>
        <MfaForm next={safeNext(next, "staff")} hasFactor={Boolean(data?.totp?.length)} />
      </>
    );
  }

  if (session) redirect(safeNext(next, STAFF_ROLES.includes(session.role) ? "staff" : "customer"));

  const notice = NOTICES[one(sp.error)];
  return (
    <>
      <h1 className="mb-2 text-3xl font-bold">
        تسجيل الدخول<span className="text-gold">.</span>
      </h1>
      <p className="mb-8 text-on-cream-muted">ادخل بالبريد الإلكتروني الذي سجّلناه لك في الاستوديو.</p>
      {one(sp.signed_out) ? (
        <p role="status" className="mb-6 rounded-sm border border-cream-line bg-cream-2 px-4 py-3">
          تم تسجيل خروجك بأمان.
        </p>
      ) : null}
      {notice ? (
        <p role="alert" className="mb-6 rounded-sm border border-danger/40 bg-danger/5 px-4 py-3 text-danger">
          {notice}
        </p>
      ) : null}
      <LoginForm next={next.startsWith("/") && !next.startsWith("//") ? next : ""} />
    </>
  );
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="grid gap-5">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      }
    >
      <LoginContent searchParams={props.searchParams} />
    </Suspense>
  );
}
