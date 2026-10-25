import { Announcements } from "@/components/layout/Announcements";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { SiteIntro } from "@/components/layout/SiteIntro";
import { STUDIO_BOOT, STUDIO_ENABLED } from "@/features/studio/config";
import { getStudioScene } from "@/features/studio/data";
import { StudioProvider } from "@/features/studio/StudioProvider";
import { StudioToggle } from "@/features/studio/StudioToggle";

/**
 * Public theme scope: `.site-public` = night background, ivory text, dark tone helpers (see globals.css).
 * With the immersive studio on (features/studio/config.ts), the pages sit inside one studio room: the scene is a
 * decorative backdrop behind the first screen; every page keeps its own HTML content, routes and metadata.
 */
export default async function PublicLayout({ children }: LayoutProps<"/">) {
  if (!STUDIO_ENABLED) {
    return (
      <div className="site-public flex flex-1 flex-col bg-night text-ivory">
        <SiteIntro />
        <Announcements />
        <Header />
        <main id="main" tabIndex={-1} className="flex-1">
          {children}
        </main>
        <Footer />
      </div>
    );
  }
  const { shared } = await getStudioScene();
  return (
    <div className="site-public relative flex flex-1 flex-col bg-night text-ivory">
      <script dangerouslySetInnerHTML={{ __html: STUDIO_BOOT }} />
      <StudioProvider shared={shared}>
        <Announcements />
        <Header />
        <main id="main" tabIndex={-1} className="relative flex-1">
          {children}
        </main>
        <StudioToggle />
        <Footer />
      </StudioProvider>
    </div>
  );
}
