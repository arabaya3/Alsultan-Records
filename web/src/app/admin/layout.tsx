import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";
import { getSessionProfile, STAFF_ROLES } from "@/lib/permissions";
import { navFor } from "@/features/admin/nav";
import { Sidebar } from "@/features/admin/Sidebar";
import { ROLE_LABEL } from "@/features/admin/labels";
import { signOutAction } from "@/features/admin/session-actions";

export const metadata: Metadata = {
  title: { default: "لوحة الإدارة", template: "%s | لوحة الإدارة" },
  robots: { index: false, follow: false },
};

async function AdminSidebar() {
  // UI only: each page re-checks the role server-side.
  await connection();
  const session = await getSessionProfile();
  if (!session || !STAFF_ROLES.includes(session.role)) return null;
  return (
    <Sidebar
      groups={navFor(session.role)}
      name={session.fullName ?? session.email ?? ""}
      roleLabel={ROLE_LABEL[session.role]}
      signOut={signOutAction}
    />
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-cream lg:flex-row">
      <Suspense fallback={<div className="h-14 bg-ink lg:h-dvh lg:w-60" aria-hidden="true" />}>
        <AdminSidebar />
      </Suspense>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
