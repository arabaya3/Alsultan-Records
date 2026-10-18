import { Announcements } from "@/components/layout/Announcements";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Announcements />
      <Header />
      <main id="main" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <Footer />
    </>
  );
}
