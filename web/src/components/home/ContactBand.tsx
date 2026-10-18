import { ButtonLink, buttonClasses } from "@/components/ui/Button";
import { Section, SectionHeading } from "@/components/ui/Layout";
import { FacebookIcon, PhoneIcon, YouTubeIcon } from "@/components/ui/SocialIcons";
import { WhatsAppLink } from "@/components/ui/WhatsAppCta";
import { bookingHref, telHref } from "@/features/public-content/contact";
import type { BusinessSettings } from "@/features/public-content/schema";
import { safeHttp } from "@/features/public-content/seo";

/**
 * Compact ivory contact band («خلّينا نحكي عن مناسبتك»): WhatsApp, phone (dir=ltr) and the YouTube/Facebook links —
 * all from business_settings; anything not set is omitted (no invented email/address).
 */
export function ContactBand({
  settings,
  id = "contact-band-title",
  title = "خلّينا نحكي عن مناسبتك",
  lead = "اكتب لنا نوع المناسبة وتاريخها ومكانها، ونرجع لك.",
  as = "h2",
}: {
  settings: BusinessSettings | null;
  id?: string;
  title?: string;
  lead?: string;
  as?: "h1" | "h2";
}) {
  const wa = bookingHref(settings);
  const yt = safeHttp(settings?.youtube_url ?? null);
  const fb = safeHttp(settings?.facebook ?? null);
  const social = buttonClasses({ variant: "outline", tone: "light", className: "min-w-44 bg-white/60" });
  return (
    <Section tone="ivory" labelledBy={id}>
      <SectionHeading id={id} as={as} title={title} lead={lead} align="center" className="!mb-8" />
      <div className="flex flex-col items-center gap-5 text-center">
        {wa ? (
          <WhatsAppLink href={wa} size="lg">
            تواصل عبر واتساب
          </WhatsAppLink>
        ) : (
          <ButtonLink href="/contact" size="lg">
            تواصل معنا
          </ButtonLink>
        )}
        {settings?.phone ? (
          <a
            href={telHref(settings.phone)}
            className="inline-flex min-h-11 items-center gap-3 text-xl font-bold underline-offset-8 hover:underline"
          >
            <PhoneIcon size={20} />
            <span dir="ltr">{settings.phone}</span>
          </a>
        ) : null}
        {yt || fb ? (
          <div className="mt-2 w-full max-w-md">
            <p className="flex items-center gap-4 text-sm text-tone-muted">
              <span aria-hidden="true" className="h-px flex-1 bg-gold/60" />
              تابعونا على
              <span aria-hidden="true" className="h-px flex-1 bg-gold/60" />
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              {yt ? (
                <a href={yt} target="_blank" rel="noopener noreferrer" className={social}>
                  <span className="text-[#c4302b]">
                    <YouTubeIcon size={20} />
                  </span>
                  قناتنا على YouTube
                </a>
              ) : null}
              {fb ? (
                <a href={fb} target="_blank" rel="noopener noreferrer" className={social}>
                  <span className="text-[#1877f2]">
                    <FacebookIcon size={20} />
                  </span>
                  صفحتنا على Facebook
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
