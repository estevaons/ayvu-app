"use client";

import { HardDrive, LogOut, Moon, Sun, SunMoon } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { ConfirmSheet } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import type { Locale } from "@/lib/dictionaries";
import { bytes } from "@/lib/format";
import { clearAllDownloads, offlineIndex, onOfflineChange } from "@/lib/offline";
import { RATES, usePlayer } from "@/lib/player";
import { usePrefs, type Theme } from "@/lib/prefs";
import { supabase } from "@/lib/supabase";

export default function SettingsPage() {
  return (
    <AppShell>
      <Settings />
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="eyebrow mb-3 px-1">{title}</h2>
      <div className="card divide-y divide-line">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3">
      <span className="text-[15px]">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-full bg-elevated p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition ${
            o.value === value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Settings() {
  const prefs = usePrefs();
  const { t } = prefs;
  const { user, signOut } = useAuth();
  const player = usePlayer();
  const [plan, setPlan] = useState<string>("free");
  const [storage, setStorage] = useState({ size: 0, count: 0 });
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!user) return;
    void supabase()
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => data?.plan && setPlan(data.plan));
  }, [user]);

  useEffect(() => {
    const refresh = () =>
      void offlineIndex().then((index) => {
        const entries = Object.values(index);
        setStorage({ size: entries.reduce((s, e) => s + (e.size || 0), 0), count: entries.length });
      });
    refresh();
    return onOfflineChange(refresh);
  }, []);

  return (
    <>
      <PageHeader title={t("settings.title")} />
      <div className="flex flex-col gap-8 animate-fade-up">
        <Section title={t("settings.account")}>
          <Row label={t("auth.email")}>
            <span className="truncate text-sm text-muted">{user?.email}</span>
          </Row>
          <Row label={t("settings.plan")}>
            <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
              {plan === "pro" ? t("settings.plan.pro") : t("settings.plan.free")}
            </span>
          </Row>
        </Section>

        <Section title={t("settings.appearance")}>
          <Row label={t("settings.theme")}>
            <Segmented<Theme>
              value={prefs.theme}
              onChange={(theme) => prefs.set({ theme })}
              options={[
                { value: "system", label: <><SunMoon className="size-3.5" />{t("settings.theme.system")}</> },
                { value: "dark", label: <><Moon className="size-3.5" />{t("settings.theme.dark")}</> },
                { value: "light", label: <><Sun className="size-3.5" />{t("settings.theme.light")}</> },
              ]}
            />
          </Row>
          <Row label={t("settings.language")}>
            <Segmented<Locale>
              value={prefs.locale}
              onChange={(locale) => prefs.set({ locale })}
              options={[
                { value: "pt-BR", label: "Português" },
                { value: "en", label: "English" },
              ]}
            />
          </Row>
        </Section>

        <Section title={t("settings.playback")}>
          <Row label={t("settings.defaultSpeed")}>
            <select
              className="h-9 rounded-full bg-elevated px-3 text-sm outline-none"
              value={prefs.defaultRate}
              onChange={(e) => prefs.set({ defaultRate: Number(e.target.value) })}
            >
              {RATES.map((r) => (
                <option key={r} value={r}>{r}×</option>
              ))}
            </select>
          </Row>
          <Row label={t("settings.autoplay")}>
            <button
              role="switch"
              aria-checked={prefs.autoplay}
              onClick={() => prefs.set({ autoplay: !prefs.autoplay })}
              className={`relative h-7 w-12 rounded-full transition ${prefs.autoplay ? "bg-accent" : "bg-line-strong"}`}
            >
              <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${prefs.autoplay ? "left-6" : "left-1"}`} />
            </button>
          </Row>
        </Section>

        <Section title={t("settings.storage")}>
          <Row label={t("settings.storageUsed", { size: bytes(storage.size), count: storage.count })}>
            <HardDrive className="size-5 text-faint" />
          </Row>
          {storage.count > 0 && (
            <button className="flex min-h-14 w-full items-center px-4 text-[15px] text-danger" onClick={() => setConfirmClear(true)}>
              {t("settings.clearDownloads")}
            </button>
          )}
        </Section>

        <button
          className="btn-secondary h-12"
          onClick={async () => {
            player.close();
            await signOut();
          }}
        >
          <LogOut className="size-4" /> {t("settings.signOut")}
        </button>
        <p className="pb-4 text-center text-xs text-faint">{t("settings.version", { version: "0.1.0" })}</p>
      </div>

      <ConfirmSheet
        open={confirmClear}
        title={t("settings.clearDownloads")}
        confirmLabel={t("common.delete")}
        danger
        onClose={() => setConfirmClear(false)}
        onConfirm={async () => {
          await clearAllDownloads();
          setConfirmClear(false);
        }}
      />
    </>
  );
}
