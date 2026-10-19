import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/States";
import { ResetPasswordForm } from "@/features/auth/components/AuthForms";
import { getSessionProfile } from "@/lib/permissions";

export const metadata: Metadata = { title: "تعيين كلمة مرور جديدة" };

async function ResetContent() {
  await connection();
  const session = await getSessionProfile();
  if (!session)
    return (
      <div role="alert">
        <p className="mb-4">انتهت صلاحية رابط إعادة التعيين أو لم يعد صالحاً.</p>
        <Link href="/login" className="underline">
          اطلب رابطاً جديداً من صفحة الدخول
        </Link>
      </div>
    );
  return <ResetPasswordForm />;
}

export default function ResetPage() {
  return (
    <>
      <h1 className="mb-8 text-3xl font-bold">
        كلمة مرور جديدة<span className="text-gold">.</span>
      </h1>
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <ResetContent />
      </Suspense>
    </>
  );
}
