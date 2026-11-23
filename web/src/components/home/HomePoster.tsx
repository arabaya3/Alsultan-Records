import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/Button";
import { PhoneIcon } from "@/components/ui/SocialIcons";
import { WhatsAppLink } from "@/components/ui/WhatsAppCta";
import { HOME_POSTER } from "@/features/public-content/home-content";
import { SITE_NAME_AR } from "@/features/public-content/site";

/**
 * Homepage sections of the owner's poster design: navy hero with a diagonal photo edge,
 * ivory «من نحن» / «كيف نوثّق مناسبتكم» / «من أعمالنا», navy contact bar. Server components only, no motion beyond
 * hover colour changes. Photos and works are passed in by the page: nothing here invents media.
 */

const column = "mx-auto w-full max-w-[70rem] px-[var(--gutter)]";
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function CameraIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 40" width={56} height={47} {...stroke} strokeWidth={2.4}>
      <path d="M6 10h8l3-5h14l3 5h8a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3Z" />
      <circle cx="24" cy="22" r="7.5" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 40" width={56} height={47} {...stroke} strokeWidth={2.4}>
      <rect x="3" y="7" width="29" height="26" rx="5" />
      <path d="M32 17l11-6.5a1 1 0 0 1 1.5.9v17.2a1 1 0 0 1-1.5.9L32 23Z" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={22} height={22} fill="currentColor">
      <path d="M12 2a7.5 7.5 0 0 0-7.5 7.5c0 5.2 6.3 11.6 6.9 12.2a.85.85 0 0 0 1.2 0c.6-.6 6.9-7 6.9-12.2A7.5 7.5 0 0 0 12 2Zm0 10.4a2.9 2.9 0 1 1 0-5.8 2.9 2.9 0 0 1 0 5.8Z" />
    </svg>
  );
}

/** Decorative olive sprig behind «من نحن» (drawn here, not a photo). */
function OliveSprig({ className = "" }: { className?: string }) {
  const leaves: [number, number, number][] = [
    [34, 150, -62], [52, 128, 18], [58, 112, -58], [78, 92, 22], [84, 76, -52], [104, 60, 26], [110, 44, -46], [130, 32, 30], [140, 16, -30],
  ];
  return (
    <svg aria-hidden="true" viewBox="0 0 170 190" className={className} fill="none">
      <path d="M8 186C40 150 90 78 158 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {leaves.map(([x, y, r], i) => (
        <ellipse key={i} cx={x} cy={y} rx="21" ry="6.5" transform={`rotate(${r} ${x} ${y})`} fill="currentColor" opacity={i % 2 ? 0.55 : 0.8} />
      ))}
      <ellipse cx="70" cy="118" rx="6" ry="7.5" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

/** Centred section title between two gold rules. */
function PosterHeading({ id, title, wide = false }: { id: string; title: string; wide?: boolean }) {
  const rule = `h-px shrink bg-gold-press ${wide ? "w-14 sm:w-56" : "w-10 sm:w-40"}`;
  return (
    <div className="flex items-center justify-center gap-4 sm:gap-8">
      <span aria-hidden="true" className={rule} />
      <h2 id={id} className="shrink-0 text-[clamp(1.625rem,1.3rem+1.6vw,2.5rem)] font-bold tracking-tight">
        {title}
      </h2>
      <span aria-hidden="true" className={rule} />
    </div>
  );
}

function ContactCta({ href, className = "" }: { href: string | null; className?: string }) {
  // Same rule as every CTA on the site: WhatsApp when configured, else the contact page.
  return href ? (
    <WhatsAppLink href={href} size="lg" className={`home-pill ${className}`}>
      {HOME_POSTER.cta}
    </WhatsAppLink>
  ) : (
    <ButtonLink href="/contact" size="lg" className={`home-pill ${className}`}>
      تواصل معنا
    </ButtonLink>
  );
}

export function PosterHero({ photoSrc, logoSrc, whatsappHref }: { photoSrc: string | null; logoSrc: string | null; whatsappHref: string | null }) {
  return (
    <section aria-labelledby="hero-title" data-home-hero className="relative isolate overflow-hidden bg-navy text-ivory">
      <div className="flex flex-col lg:grid lg:min-h-[clamp(30rem,40vw,40rem)] lg:grid-cols-2">
        {/* First in the DOM = right-hand column in RTL; on phones the photo is shown above it. */}
        <div className="order-2 flex flex-col items-center justify-center px-[var(--gutter)] pt-6 pb-10 text-center lg:order-1 lg:py-12">
          <Logo height={132} asLink={false} priority src={logoSrc} className="max-lg:!h-24" />
          <h1 id="hero-title" className="relative mt-5 text-[clamp(1.875rem,1.2rem+3.4vw,3.5rem)] leading-[1.3] lg:text-[clamp(2.5rem,3.5vw,3.5rem)] font-bold tracking-tight">
            <span aria-hidden="true" className="absolute -top-5 -right-6 font-display text-[1.4em] leading-none text-gold max-sm:-right-2 max-sm:-top-4">
              ”
            </span>
            <span className="block sm:whitespace-nowrap">{HOME_POSTER.titleLines[0]}</span>
            <span className="block sm:whitespace-nowrap">{HOME_POSTER.titleLines[1]}</span>
          </h1>
          <svg aria-hidden="true" viewBox="0 0 280 16" className="mt-1 h-3 w-56 text-gold sm:w-72" fill="none">
            <path d="M2 12C70 4 170 1 278 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <p className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-lg text-ivory/90 sm:text-xl">
            <span>{SITE_NAME_AR}</span>
            <span aria-hidden="true" className="h-5 w-px bg-gold max-sm:hidden" />
            <span>{HOME_POSTER.location}</span>
          </p>
          <ContactCta href={whatsappHref} className="mt-6 min-w-64 sm:min-w-80" />
        </div>

        <div data-home-hero-photo className="home-hero-photo relative order-1 aspect-[4/3] sm:aspect-[16/9] lg:order-2 lg:aspect-auto">
          {photoSrc ? (
            // Decorative studio photo (the owner's hero photo, through /p). Cropped to the panel like the old backdrop.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoSrc} alt="" fetchPriority="high" decoding="async" className="absolute inset-0 size-full bg-navy-deep object-cover object-[50%_18%]" />
          ) : (
            <div className="ink-texture absolute inset-0" />
          )}
        </div>
      </div>
    </section>
  );
}

export function PosterAbout() {
  return (
    <section aria-labelledby="about-title" data-home-section="about" className="relative py-10 sm:py-12">
      <OliveSprig className="pointer-events-none absolute end-0 top-2 w-44 text-cream-line max-sm:hidden" />
      <div className={`${column} relative`}>
        <PosterHeading id="about-title" title={HOME_POSTER.about.title} />
        <p className="mt-5 text-center text-lg text-on-cream sm:text-xl">{HOME_POSTER.about.body}</p>
        <p className="mx-auto mt-7 flex max-w-[57rem] flex-col items-center justify-center gap-x-6 gap-y-1 rounded-2xl bg-cream-2 px-6 py-5 text-center font-display text-[clamp(1.25rem,1rem+1.3vw,2rem)] font-bold sm:flex-row">
          <span>{HOME_POSTER.about.team[0]}</span>
          <span aria-hidden="true" className="font-normal max-sm:hidden">
            —
          </span>
          <span>{HOME_POSTER.about.team[1]}</span>
        </p>
      </div>
    </section>
  );
}

export function PosterServices() {
  const icons = [<CameraIcon key="photo" />, <VideoIcon key="video" />];
  return (
    <section aria-labelledby="services-title" data-home-section="services" className="pb-10 sm:pb-12">
      <div className={column}>
        <PosterHeading id="services-title" title={HOME_POSTER.services.title} wide />
        <ul className="mt-8 grid gap-8 sm:grid-cols-2 sm:gap-0 sm:divide-x sm:divide-gold-press/60">
          {HOME_POSTER.services.items.map((x, i) => (
            <li key={x.title} className="flex justify-center sm:px-6">
              <div className="flex max-w-md items-start gap-4">
                <span className="mt-1 shrink-0 text-gold-press">{icons[i]}</span>
                <div>
                  <h3 className="text-[clamp(1.375rem,1.1rem+1vw,1.875rem)] font-bold">{x.title}</h3>
                  <p className="mt-2 text-lg text-on-cream-muted">{x.body}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export type PosterWork = {
  key: string;
  href: string;
  /** The work's own title: the link's accessible name. */
  title: string;
  src: string;
  srcSet?: string;
  /** Album photos are shown whole; a 16:9 video thumbnail fills its 16:9 frame. */
  fit: "contain" | "cover";
};

export function PosterWorks({ works }: { works: PosterWork[] }) {
  return (
    <section aria-labelledby="work-title" data-home-section="works" className="pb-12 sm:pb-14">
      <div className={column}>
        <PosterHeading id="work-title" title={HOME_POSTER.works.title} />
        {works.length ? (
          <ul className="mx-auto mt-8 grid max-w-[57rem] gap-3 sm:grid-cols-2">
            {works.map((w) => (
              <li key={w.key}>
                <Link
                  href={w.href}
                  data-home-work={w.key}
                  className="group relative block aspect-video overflow-hidden bg-night-deep outline-offset-4 transition-shadow duration-200 hover:shadow-[0_0_0_3px_var(--color-gold-press)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={w.src}
                    srcSet={w.srcSet}
                    sizes={w.srcSet ? "(min-width: 640px) 456px, 100vw" : undefined}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={`absolute inset-0 size-full ${w.fit === "contain" ? "object-contain" : "object-cover"}`}
                  />
                  <span className="sr-only">{w.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p role="status" className="mt-8 text-center text-on-cream-muted">
            {HOME_POSTER.works.empty}
          </p>
        )}
      </div>
    </section>
  );
}

export function PosterContactBar({ whatsappHref, phone }: { whatsappHref: string | null; phone: { label: string; href: string } | null }) {
  const cell = "inline-flex min-h-11 items-center gap-3 text-xl font-medium";
  return (
    <section aria-labelledby="contact-title" data-home-section="contact" className="home-contact-bar relative bg-navy text-ivory">
      <h2 id="contact-title" className="sr-only">
        {HOME_POSTER.contactTitle}
      </h2>
      <div className={`${column} flex flex-col items-center justify-center gap-x-8 gap-y-3 py-6 md:flex-row md:py-5`}>
        <p className={cell}>
          <span className="text-gold">
            <PinIcon />
          </span>
          {HOME_POSTER.location}
        </p>
        {phone ? (
          <>
            <span aria-hidden="true" className="h-11 w-0.5 bg-gold max-md:hidden" />
            <a href={phone.href} data-home-phone className={`${cell} transition-colors hover:text-gold`}>
              <PhoneIcon size={22} />
              <span className="sr-only">الهاتف: </span>
              <span dir="ltr" className="font-bold tracking-wide">
                {phone.label}
              </span>
            </a>
          </>
        ) : null}
        <span aria-hidden="true" className="h-11 w-0.5 bg-gold max-md:hidden" />
        <ContactCta href={whatsappHref} className="min-w-64 sm:min-w-80" />
      </div>
    </section>
  );
}
