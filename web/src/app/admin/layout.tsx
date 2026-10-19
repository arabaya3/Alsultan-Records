import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";
import { getSessionProfile, STAFF_ROLES } from "@/lib/permissions";
import { DEFAULT_MODULES, navFor } from "@/features/admin/nav";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/features/admin/Sidebar";
import { ROLE_LABEL } from "@/features/admin/labels";
import { signOutAction } from "@/features/admin/session-actions";

export const metadata: Metadata = {
  // Dashboard home-screen app (the public site has its own manifest).
  manifest: "/app.webmanifest",
  appleWebApp: { capable: true, title: "لوحة السلطان", statusBarStyle: "black" },
  title: { default: "لوحة الإدارة", template: "%s | لوحة الإدارة" },
  robots: { index: false, follow: false },
};

async function AdminSidebar() {
  // UI only: each page re-checks the role server-side.
  await connection();
  const session = await getSessionProfile();
  if (!session || !STAFF_ROLES.includes(session.role)) return null;
  // Enabled modules only hide nav entries (UX); on error fall back to the defaults.
  const sb = await createClient();
  const { data: enabled } = await sb.rpc("admin_enabled_modules");
  return (
    <Sidebar
      groups={navFor(session.role, enabled ?? DEFAULT_MODULES)}
      name={session.fullName ?? session.email ?? ""}
      roleLabel={ROLE_LABEL[session.role]}
      signOut={signOutAction}
    />
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-cream lg:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-gold focus:px-4 focus:py-2 focus:text-ink"
      >
        تخطَّ إلى المحتوى
      </a>
      <Suspense fallback={<div className="h-14 bg-ink lg:h-dvh lg:w-60" aria-hidden="true" />}>
        <AdminSidebar />
      </Suspense>
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
