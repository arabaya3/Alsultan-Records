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
 * hover colour changes. Titles, intros, photos and works are passed in by the page (the owner's saved settings):
 * nothing here invents media.
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

/** Centred section title between two gold rules; `pill` sets it on a soft beige pill (ivory sections). */
export function PosterHeading({ id, title, wide = false, pill = false }: { id: string; title: string; wide?: boolean; pill?: boolean }) {
  const rule = `h-px min-w-6 flex-1 bg-gold-press ${wide ? "sm:max-w-56" : "sm:max-w-40"} ${pill ? "max-sm:min-w-3" : ""}`;
  return (
    <div className="flex items-center justify-center gap-4 sm:gap-8">
      <span aria-hidden="true" className={rule} />
      {/* The owner's title can be long: it wraps between the rules instead of pushing them off the screen. */}
      <h2
        id={id}
        className={`min-w-0 text-center font-bold tracking-tight break-words ${
          pill ? "rounded-full bg-cream-2 px-6 py-2 text-[clamp(1.25rem,1.05rem+1.2vw,2.125rem)] text-balance sm:px-10 sm:py-2.5" : "text-[clamp(1.625rem,1.3rem+1.6vw,2.5rem)]"
        }`}
      >
        {title}
      </h2>
      <span aria-hidden="true" className={rule} />
    </div>
  );
}

/** Soft card on the ivory bands (about, services). */
const card = "rounded-3xl bg-white/75 shadow-[0_14px_34px_-18px_rgb(60_45_20/0.35)] ring-1 ring-cream-line";

function WomanIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" width={30} height={30} {...stroke} strokeWidth={1.8}>
      <path d="M8.5 15.5C8.5 9.5 11.5 5 16 5s7.5 4.5 7.5 10.5c0 3-.8 5-2 6.5" />
      <path d="M10.5 22c-1.2-1.5-2-3.5-2-6.5" />
      <circle cx="16" cy="14" r="4.2" />
      <path d="M7 28c1.2-4 4.8-6.5 9-6.5s7.8 2.5 9 6.5" />
    </svg>
  );
}

function ManIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" width={30} height={30} {...stroke} strokeWidth={1.8}>
      <circle cx="16" cy="11" r="5" />
      <path d="M7 28c1.2-5 4.8-8 9-8s7.8 3 9 8" />
    </svg>
  );
}

function PlayBadge() {
  return (
    <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
      <span className="grid size-16 place-items-center rounded-full bg-navy/70 text-ivory ring-2 ring-gold backdrop-blur-[2px] transition-transform duration-200 group-hover:scale-110 sm:size-[4.5rem]">
        <svg viewBox="0 0 24 24" width={26} height={26} fill="currentColor" className="translate-x-[2px]">
          <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
        </svg>
      </span>
    </span>
  );
}

/** The owner's optional section intro, under the heading. */
function Lead({ text }: { text: string | null }) {
  return text ? (
    <p data-section-intro className="mx-auto mt-4 max-w-3xl text-center text-lg break-words whitespace-pre-line text-tone-muted">
      {text}
    </p>
  ) : null;
}

function ContactCta({ href, label, className = "" }: { href: string | null; label: string; className?: string }) {
  // Same rule as every CTA on the site: WhatsApp when configured, else the contact page.
  return href ? (
    <WhatsAppLink href={href} size="lg" className={`home-pill ${className}`}>
      {label}
    </WhatsAppLink>
  ) : (
    <ButtonLink href="/contact" size="lg" className={`home-pill ${className}`}>
      تواصل معنا
    </ButtonLink>
  );
}

/** src = the sharp photo; placeholderSrc = its small variant, painted first while the sharp one is still on its way. */
export type HeroPhoto = { src: string; placeholderSrc: string };

/** Hero. title / sub / ctaLabel are the owner's saved texts (admin «الصفحة الرئيسية»); null = the poster's own text. */
export function PosterHero({
  photo,
  logoSrc,
  whatsappHref,
  title,
  sub,
  ctaLabel,
  photoSlot,
  stats = [],
}: {
  /** Owner-typed counters (videos, photos, events); only the filled ones. Empty → no block. */
  stats?: { value: number; label: string; key: string }[];
  photo: HeroPhoto | null;
  /** Replaces the single photo (the home slideshow); `photo` is then only its fallback. */
  photoSlot?: React.ReactNode;
  logoSrc: string | null;
  whatsappHref: string | null;
  title: string | null;
  sub: string | null;
  ctaLabel: string | null;
}) {
  return (
    <section aria-labelledby="hero-title" data-home-hero className="relative isolate overflow-hidden bg-navy text-ivory">
      <div className="flex flex-col lg:grid lg:min-h-[clamp(26.875rem,31vw,28.75rem)] lg:grid-cols-2">
        {/* First in the DOM = right-hand column in RTL; on phones the photo is shown above it. */}
        <div className="order-2 flex min-w-0 flex-col items-center justify-center gap-8 px-[var(--gutter)] pt-6 pb-10 text-center lg:order-1 lg:flex-row lg:gap-10 lg:py-7 xl:gap-14">
        <div className="flex min-w-0 flex-col items-center">
          <Logo height={132} asLink={false} priority src={logoSrc} className="!h-24 lg:!h-[5.5rem]" sizes="116px" />
          <h1 id="hero-title" className="relative mt-5 max-w-full text-[clamp(1.875rem,1.2rem+3.4vw,3.5rem)] leading-[1.3] font-bold tracking-tight break-words lg:mt-4 lg:text-[clamp(2.25rem,2.9vw,3rem)] lg:leading-[1.25]">
            <span aria-hidden="true" className="absolute -top-5 -right-6 font-display text-[1.4em] leading-none text-gold max-sm:-top-4 max-sm:-right-2">
              ”
            </span>
            {title ? (
              <span data-hero-title="saved" className="block max-w-[20ch]">
                {title}
              </span>
            ) : (
              <>
                <span className="block sm:whitespace-nowrap">{HOME_POSTER.titleLines[0]}</span>{" "}
                <span className="block sm:whitespace-nowrap">{HOME_POSTER.titleLines[1]}</span>
              </>
            )}
          </h1>
          <svg aria-hidden="true" viewBox="0 0 280 16" className="mt-1 h-3 w-56 text-gold sm:w-72" fill="none">
            <path d="M2 12C70 4 170 1 278 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          {sub ? (
            <p data-hero-sub="saved" className="mt-4 max-w-xl text-lg break-words whitespace-pre-line text-ivory/90 sm:text-xl">
              {sub}
            </p>
          ) : (
            <p data-hero-sub="default" className="mt-4 lg:mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-lg text-ivory/90 sm:text-xl">
              <span>{SITE_NAME_AR}</span>
              <span aria-hidden="true" className="h-5 w-px bg-gold max-sm:hidden" />
              <span>{HOME_POSTER.location}</span>
            </p>
          )}
          <ContactCta href={whatsappHref} label={ctaLabel ?? HOME_POSTER.cta} className="mt-6 min-w-64 sm:min-w-80 lg:mt-5" />
        </div>
        {stats.length ? (
          // Beside the title on wide screens (the empty side of the panel), a row under the button on phones.
          <ul data-hero-stats aria-label="أرقامنا" className="flex w-full max-w-md justify-center gap-6 sm:gap-10 lg:w-auto lg:shrink-0 lg:flex-col lg:gap-5">
            {stats.map((s, i) => (
              <li key={s.key} data-hero-stat={s.key} className="flex flex-col items-center">
                {i > 0 ? <span aria-hidden="true" className="mb-5 hidden h-px w-12 bg-gold/60 lg:block" /> : null}
                <span className="font-display text-[clamp(1.75rem,1.2rem+2.2vw,2.75rem)] leading-none font-bold tracking-tight text-gold" dir="ltr">
                  {s.value.toLocaleString("en-US")}
                </span>
                <span className="mt-2 text-sm font-bold text-ivory sm:text-base">{s.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
        </div>

        <div data-home-hero-photo className="home-hero-photo relative order-1 aspect-[4/3] bg-navy-deep sm:aspect-[16/9] lg:order-2 lg:aspect-auto">
          {photoSlot ?? (photo ? (
            // Decorative studio photo (the owner's hero photo, through /p), cropped to the panel. Two layers of the same
            // photo: the 15 KB variant paints within the first seconds on a slow phone, the sharp one covers it as soon
            // as it arrives (measured: the sharp file is ~10× heavier and no stored variant sits between them).
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.placeholderSrc} data-hero-photo="placeholder" alt="" aria-hidden="true" fetchPriority="high" decoding="async" className="absolute inset-0 size-full object-cover object-[50%_18%]" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.src} data-hero-photo="sharp" alt="" fetchPriority="high" decoding="async" className="absolute inset-0 size-full object-cover object-[50%_18%]" />
            </>
          ) : (
            <div className="ink-texture absolute inset-0" />
          ))}
        </div>
      </div>
    </section>
  );
}

const ivory = "tone-ivory bg-ivory-band text-on-cream";
const pad = "py-7 sm:py-8";

/** The two teams as one drawing: a woman (head covered) and a man side by side, in the poster's gold line. */
function TeamIcon({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 120 90" className={className} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      {/* woman */}
      <path d="M22 44c0-14 7-24 18-24s18 10 18 24c0 6-2 10-5 13" />
      <path d="M27 57c-3-3-5-7-5-13" />
      <circle cx="40" cy="38" r="8.5" />
      <path d="M14 84c2-12 12-20 26-20s24 8 26 20" />
      {/* man */}
      <circle cx="82" cy="34" r="10" />
      <path d="M58 84c2-14 11-23 24-23s22 9 24 23" />
      <path d="M78 61l4 7 4-7" />
    </svg>
  );
}

export function PosterAbout({ title, intro }: { title: string; intro: string | null }) {
  const team = [
    { label: HOME_POSTER.about.team[0], icon: <WomanIcon /> },
    { label: HOME_POSTER.about.team[1], icon: <ManIcon /> },
  ];
  return (
    <section aria-labelledby="about-title" data-home-section="about" data-tone="ivory" className={`relative ${ivory} ${pad}`}>
      <OliveSprig className="pointer-events-none absolute end-0 top-2 w-44 text-cream-line max-sm:hidden" />
      <div className={`${column} relative`}>
        <PosterHeading id="about-title" title={title} />
        <p data-section-intro className="mx-auto mt-5 max-w-3xl text-center text-lg break-words whitespace-pre-line text-on-cream-muted sm:text-xl">
          {intro ?? HOME_POSTER.about.body}
        </p>
        <div data-about-card className={`mx-auto mt-8 grid max-w-[46rem] overflow-hidden ${card} grid-cols-[1.6fr_1fr] sm:grid-cols-[1.25fr_1fr]`}>
          <ul className="flex flex-col justify-center gap-4 p-4 sm:gap-6 sm:p-8">
            {team.map((t) => (
              <li key={t.label} className="flex items-center gap-2.5 sm:gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-cream-2 text-gold-press sm:size-14">{t.icon}</span>
                <span className="text-base font-bold sm:text-xl">{t.label}</span>
              </li>
            ))}
          </ul>
          <div data-about-team-icon className="grid min-h-40 place-items-center border-s border-cream-line bg-cream-2/60 p-4">
            <TeamIcon className="h-24 w-32 text-gold-press sm:h-28 sm:w-40" />
          </div>
        </div>
      </div>
    </section>
  );
}

export function PosterServices({ title, intro }: { title: string; intro: string | null }) {
  const icons = [<CameraIcon key="photo" />, <VideoIcon key="video" />];
  return (
    <section aria-labelledby="services-title" data-home-section="services" data-tone="ivory" className={`${ivory} ${pad}`}>
      <div className={column}>
        <PosterHeading id="services-title" title={title} wide pill />
        <Lead text={intro} />
        <ul className="mx-auto mt-8 grid max-w-[57rem] gap-4 sm:grid-cols-2 sm:gap-6">
          {HOME_POSTER.services.items.map((x, i) => (
            <li key={x.title} className={`flex items-center gap-5 p-5 sm:p-6 ${card}`}>
              <span className={`grid size-[4.5rem] shrink-0 place-items-center rounded-[42%_58%_55%_45%/50%_45%_55%_50%] text-gold-press sm:size-20 ${i ? "bg-gold/15" : "bg-cream-2"}`}>
                {icons[i]}
              </span>
              <div className="min-w-0">
                <h3 className="text-[clamp(1.25rem,1.1rem+0.8vw,1.625rem)] font-bold">{x.title}</h3>
                <p className="mt-1.5 text-base text-on-cream-muted sm:text-lg">{x.body}</p>
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
  /** A video opens a player: the card shows a play badge so it does not read as a photo. */
  video?: boolean;
  /** Album photos are shown whole; a 16:9 video thumbnail fills its 16:9 frame. */
  fit: "contain" | "cover";
};

/** «من أعمالنا»: as many works as the owner's limit allows (the poster shows two). */
export function PosterWorks({ title, intro, works }: { title: string; intro: string | null; works: PosterWork[] }) {
  const grid = works.length === 1 ? "max-w-[28rem]" : works.length === 2 ? "max-w-[57rem] sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <section aria-labelledby="work-title" data-home-section="works" data-tone="ivory" className={`${ivory} ${pad} pb-12 sm:pb-14`}>
      <div className={column}>
        <PosterHeading id="work-title" title={title} pill />
        <Lead text={intro} />
        {works.length ? (
          <ul className={`mx-auto mt-8 grid gap-3 ${grid}`}>
            {works.map((w) => (
              <li key={w.key}>
                <Link
                  href={w.href}
                  data-home-work={w.key}
                  className="group relative block aspect-video overflow-hidden rounded-2xl bg-night-deep outline-offset-4 transition-shadow duration-200 hover:shadow-[0_0_0_3px_var(--color-gold-press)]"
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
                  {w.video ? <PlayBadge /> : null}
                  <span className="sr-only">{w.video ? `فيديو: ${w.title}` : w.title}</span>
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

/**
 * Contact bar. Its details come from business_settings and it has no visible heading in the design. `over` is the band
 * it follows: on ivory it keeps the design's rounded shoulders, after a navy band it is a plain bar.
 */
export function PosterContactBar({
  whatsappHref,
  phone,
  ctaLabel,
  over,
}: {
  whatsappHref: string | null;
  phone: { label: string; href: string } | null;
  ctaLabel: string | null;
  over: "ivory" | "navy";
}) {
  const cell = "inline-flex min-h-11 items-center gap-3 text-xl font-medium";
  return (
    <div className={over === "ivory" ? "bg-ivory-band" : "bg-navy"}>
      <section
        aria-labelledby="contact-title"
        data-home-section="contact"
        data-tone="navy"
        className={`relative bg-navy text-ivory ${over === "ivory" ? "home-contact-bar" : "border-t border-hairline-gold"}`}
      >
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
          <ContactCta href={whatsappHref} label={ctaLabel ?? HOME_POSTER.cta} className="min-w-64 sm:min-w-80" />
        </div>
      </section>
    </div>
  );
}

/**
 * Navy band for the owner's other home sections (offers, albums, counter, promos, how we work): the poster's centred
 * heading, the site's own dark cards inside.
 */
export function PosterBand({
  id,
  name,
  title,
  intro,
  action,
  children,
}: {
  id: string;
  name: string;
  title: string;
  intro: string | null;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} data-home-section={name} data-tone="navy" className="tone-dark bg-navy py-10 text-ivory sm:py-12">
      <div className="mx-auto w-full max-w-[var(--content-max)] px-[var(--gutter)]">
        <PosterHeading id={id} title={title} />
        <Lead text={intro} />
        <div className="mt-8">{children}</div>
        {action ? <div className="mt-8 flex justify-center">{action}</div> : null}
      </div>
    </section>
  );
}
