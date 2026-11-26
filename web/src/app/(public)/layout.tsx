import { Announcements } from "@/components/layout/Announcements";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { SiteIntro } from "@/components/layout/SiteIntro";
import { HideOnHome } from "@/components/offers/HideOnHome";
import { OfferBar } from "@/components/offers/OfferBar";

/** Public theme scope: `.site-public` = night background, ivory text, dark tone helpers (see globals.css). */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="site-public flex flex-1 flex-col bg-night text-ivory">
      <SiteIntro />
      <Announcements />
      <Header />
      {/* On the home page the offers show as a carousel under the hero instead. */}
      <HideOnHome>
        <OfferBar />
      </HideOnHome>
      <main id="main" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}
