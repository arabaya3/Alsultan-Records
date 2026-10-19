import type { Metadata } from "next";
import { Logo } from "@/components/brand/Logo";

export const metadata: Metadata = {
  // Dashboard home-screen app (the public site has its own manifest).
  manifest: "/app.webmanifest",
  appleWebApp: { capable: true, title: "لوحة السلطان", statusBarStyle: "black" }, robots: { index: false, follow: false } };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-ink text-on-dark md:flex-row">
      <aside className="flex items-center justify-center px-6 py-10 md:w-[42%] md:py-0">
        <div className="text-center">
          <Logo height={110} priority />
          <p className="mt-6 font-display text-2xl font-semibold">
            بوابة العميل<span className="text-gold">.</span>
          </p>
          <p className="mt-2 text-muted">صورك وأفلامك وعقودك في مكان واحد.</p>
        </div>
      </aside>
      <main id="main" tabIndex={-1} className="flex flex-1 items-center justify-center bg-cream px-4 py-12 text-on-cream md:px-10">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
