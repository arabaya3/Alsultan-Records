import Link from "next/link";
import type { ReactNode } from "react";
import { ALL_STAFF, guard } from "./guard";
import { SETTINGS_GROUPS, SETTINGS_TABS } from "./nav";
import { PageHeader } from "./ui";
import { IconDatabase, IconFacebook, IconLayers, IconStore, IconUser, IconUsers } from "./icons";

const ICON: Record<string, ReactNode> = {
  "/admin/content/identity": <IconStore size={22} />,
  "/admin/settings": <IconLayers size={22} />,
  "/admin/account": <IconUser size={22} />,
  "/admin/users": <IconUsers size={22} />,
  "/admin/settings/facebook": <IconFacebook size={22} />,
  "/admin/backups": <IconDatabase size={22} />,
};

/**
 * One «الإعدادات» page with an inner menu (هوية النشاط، القائمة والأقسام، حسابي، المستخدمون والصلاحيات، فيسبوك، النسخ
 * الاحتياطي): one section shown at a time, each still its own page and URL with its own role check. Only the entries the
 * viewer's role may open are listed (same rule as before); with a single entry the menu is not shown.
 */
export async function SettingsFrame({ current, title, lead, children }: { current: string; title: string; lead?: ReactNode; children: ReactNode }) {
  const session = await guard(ALL_STAFF);
  const allowed = new Set(session ? SETTINGS_TABS.filter((t) => t.roles.includes(session.role)).map((t) => t.href) : []);
  const groups = SETTINGS_GROUPS.map((g) => ({ ...g, items: g.items.filter((h) => allowed.has(h)) })).filter((g) => g.items.length);
  const label = (href: string) => SETTINGS_TABS.find((t) => t.href === href)?.label ?? href;
  const showMenu = allowed.size > 1;
  return (
    <>
      <PageHeader title={showMenu ? "الإعدادات" : title} lead={showMenu ? "إدارة الموقع والحساب من مكان واضح" : lead} />
      <div className={showMenu ? "grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]" : ""}>
        {showMenu ? (
          <nav aria-label="أقسام الإعدادات" data-testid="page-tabs" className="rounded-2xl border border-cream-line bg-[#fffdf8] p-4 shadow-[0_8px_24px_-20px_rgb(60_45_20/0.4)] lg:sticky lg:top-6">
            {groups.map((g, gi) => (
              <div key={g.title} className={gi ? "mt-4 border-t border-cream-line pt-4" : ""}>
                <p className="px-3 pb-2 font-display text-base font-bold text-on-cream-muted">{g.title}</p>
                <ul className="space-y-1">
                  {g.items.map((href) => {
                    const on = href === current;
                    return (
                      <li key={href}>
                        <Link
                          href={href}
                          aria-current={on ? "page" : undefined}
                          className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-base transition-colors ${
                            on ? "border-e-[3px] border-gold bg-gold/20 font-bold text-on-cream" : "text-on-cream hover:bg-cream-2"
                          }`}
                        >
                          <span aria-hidden="true" className={on ? "text-gold-press" : "text-on-cream-muted"}>
                            {ICON[href]}
                          </span>
                          {label(href)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        ) : null}
        <section aria-labelledby="settings-section-title" className={showMenu ? "rounded-2xl border border-cream-line bg-[#fffdf8] p-4 shadow-[0_8px_24px_-20px_rgb(60_45_20/0.4)] md:p-6" : ""}>
          {showMenu ? (
            <div className="mb-5">
              <h2 id="settings-section-title" className="font-display text-2xl font-bold md:text-3xl">
                {title}
              </h2>
              <span aria-hidden="true" className="mt-2 block h-0.5 w-16 rounded-full bg-gold" />
              {lead ? <div className="mt-3 text-sm text-on-cream-muted md:text-base">{lead}</div> : null}
            </div>
          ) : (
            <h2 id="settings-section-title" className="sr-only">
              {title}
            </h2>
          )}
          {children}
        </section>
      </div>
    </>
  );
}

