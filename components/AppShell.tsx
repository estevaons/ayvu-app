"use client";

import { LibraryBig, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { usePlayer } from "@/lib/player";
import { usePrefs } from "@/lib/prefs";
import { MiniPlayer } from "./Player";
import { SplashView } from "./ui";

const TABS = [
  { href: "/library/", icon: LibraryBig, key: "nav.library" },
  { href: "/add/", icon: Plus, key: "nav.add" },
  { href: "/settings/", icon: Settings2, key: "nav.settings" },
] as const;

/** Signed-in layout: content, mini player and tab bar. Redirects to /login when signed out. */
export function AppShell({ children, hideTabs = false }: { children: React.ReactNode; hideTabs?: boolean }) {
  const { ready, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = usePrefs();
  const player = usePlayer();

  useEffect(() => {
    if (ready && !user) router.replace("/login/");
  }, [ready, user, router]);

  if (!ready || !user) {
    return <SplashView />;
  }

  const bottomSpace = (player.book ? 76 : 0) + (hideTabs ? 16 : 72);

  return (
    <div className="min-h-dvh">
      <main className="mx-auto w-full max-w-3xl px-4 pt-safe sm:px-6" style={{ paddingBottom: `calc(${bottomSpace}px + env(safe-area-inset-bottom))` }}>
        {children}
      </main>

      {/* Sem abas, a área segura fica no próprio container; com abas, o fundo da barra cobre até a borda. */}
      <div className={`fixed inset-x-0 bottom-0 z-40 flex flex-col gap-2 ${hideTabs ? "pb-safe" : ""}`}>
        <MiniPlayer />
        {!hideTabs && (
          <nav className="border-t border-line bg-bg/90 pb-safe backdrop-blur-xl">
            <ul className="mx-auto flex max-w-3xl">
              {TABS.map(({ href, icon: Icon, key }) => {
                const active = pathname?.startsWith(href.slice(0, -1));
                return (
                  <li key={href} className="flex-1">
                    <Link
                      href={href}
                      className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition ${active ? "text-accent" : "text-faint hover:text-muted"}`}
                    >
                      {/* Mesma caixa 28px para todos os ícones, assim os rótulos ficam na mesma linha. */}
                      {href === "/add/" ? (
                        <span className={`grid size-7 place-items-center rounded-full ${active ? "bg-accent text-accent-ink" : "bg-elevated text-ink"}`}>
                          <Icon className="size-4.5" strokeWidth={2.4} />
                        </span>
                      ) : (
                        <span className="grid size-7 place-items-center">
                          <Icon className="size-6" strokeWidth={active ? 2.2 : 1.8} />
                        </span>
                      )}
                      {t(key)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}

export function PageHeader({ title, eyebrow, action }: { title: string; eyebrow?: string; action?: React.ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-4 pt-6 pb-5">
      <div>
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="font-serif text-[32px] leading-none tracking-tight">{title}</h1>
      </div>
      {action}
    </header>
  );
}
