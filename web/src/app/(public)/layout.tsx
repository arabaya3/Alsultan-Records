import { Announcements } from "@/components/layout/Announcements";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

/** Public theme scope: `.site-public` = night background, ivory text, dark tone helpers (see globals.css). */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="site-public flex flex-1 flex-col bg-night text-ivory">
      <Announcements />
      <Header />
      <main id="main" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}
