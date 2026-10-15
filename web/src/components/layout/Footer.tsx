import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { Container } from "@/components/ui/Layout";
import { getBusinessSettings } from "@/features/public-content/queries";
import { NAV_LINKS, SITE_NAME_AR } from "@/features/public-content/site";
import { safeHttp } from "@/features/public-content/seo";

const MORE_LINKS = [
  { href: "/book", label: "احجز مناسبتك" },
  { href: "/track", label: "تابع طلبك" },
  { href: "/faq", label: "أسئلة شائعة" },
  { href: "/contact", label: "تواصل معنا" },
] as const;

function waLink(num: string) {
  return `https://wa.me/${num.replace(/[^\d]/g, "")}`;
}

export async function Footer() {
  const settings = await getBusinessSettings();
  const s = settings.status === "ok" ? settings.data : null;
  const contacts = [
    s?.phone ? { href: `tel:${s.phone.replace(/\s/g, "")}`, label: s.phone, name: "هاتف", ltr: true } : null,
    s?.whatsapp ? { href: waLink(s.whatsapp), label: "واتساب", name: "واتساب", ltr: false } : null,
    s?.email ? { href: `mailto:${s.email}`, label: s.email, name: "بريد", ltr: true } : null,
    s && safeHttp(s.instagram) ? { href: s.instagram as string, label: "إنستغرام", name: "إنستغرام", ltr: false } : null,
    s && safeHttp(s.facebook) ? { href: s.facebook as string, label: "فيسبوك", name: "فيسبوك", ltr: false } : null,
  ].filter((x) => x !== null);

  return (
    <footer className="mt-auto bg-ink text-on-dark">
      <Container className="grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo height={72} />
          <p className="mt-4 max-w-sm text-muted">
            {s?.tagline ?? "تصوير فوتوغرافي وأفلام أعراس ومناسبات وDJ."}
          </p>
          {s?.address ? <p className="mt-2 text-muted">{s.address}</p> : null}
        </div>
        <nav aria-label="روابط الموقع">
          <ul className="grid gap-2">
            {[...NAV_LINKS, ...MORE_LINKS].map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-gold">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          {contacts.length ? (
            <ul className="grid gap-2">
              {contacts.map((c) => (
                <li key={c.name}>
                  <a
                    href={c.href}
                    dir={c.ltr ? "ltr" : undefined}
                    className="hover:text-gold"
                    {...(c.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  >
                    {c.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <Link href="/contact" className="hover:text-gold">
              تواصل معنا
            </Link>
          )}
        </div>
      </Container>
      <div className="border-t border-ink-line">
        <Container className="flex flex-wrap justify-between gap-4 py-5 text-sm text-muted">
          <p>
            © {SITE_NAME_AR}
          </p>
          <ul className="flex gap-6">
            <li>
              <Link href="/privacy" className="hover:text-gold">
                الخصوصية
              </Link>
            </li>
            <li>
              <Link href="/terms" className="hover:text-gold">
                الشروط
              </Link>
            </li>
          </ul>
        </Container>
      </div>
    </footer>
  );
}
