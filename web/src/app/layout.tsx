import type { Metadata, Viewport } from "next";
import { Alexandria, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { siteUrl, SITE_NAME_AR } from "@/features/public-content/site";

const alexandria = Alexandria({
  subsets: ["arabic", "latin"],
  variable: "--font-alexandria",
  display: "swap",
});

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${SITE_NAME_AR} | تصوير وأفلام أعراس ومناسبات`,
    template: `%s | ${SITE_NAME_AR}`,
  },
  description:
    "ستوديو وتسجيلات السلطان في ميثلون – جنين: تصوير فوتوغرافي وأفلام أعراس وتنسيق مناسبات وDJ.",
  applicationName: SITE_NAME_AR,
  openGraph: {
    type: "website",
    locale: "ar_PS",
    siteName: SITE_NAME_AR,
    images: [{ url: "/brand/logo-main.webp", width: 900, height: 748, alt: SITE_NAME_AR }],
  },
  icons: { icon: "/favicon.ico", apple: "/icons/apple-touch-icon.png" },
  // iOS home-screen app (Android uses app/manifest.ts).
  appleWebApp: { capable: true, title: "السلطان", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning className={`${alexandria.variable} ${plexArabic.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
