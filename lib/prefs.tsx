"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { dictionaries, type DictKey, type Locale } from "./dictionaries";
import { interpolate } from "./format";
import { kv } from "./platform";

export type Theme = "system" | "dark" | "light";

export interface Prefs {
  locale: Locale;
  theme: Theme;
  defaultRate: number;
  autoplay: boolean;
  /** Show the chapter text being written along with the narration in the full player. */
  readAlong: boolean;
}

const DEFAULTS: Prefs = { locale: "pt-BR", theme: "system", defaultRate: 1, autoplay: true, readAlong: true };
const KEY = "ayvu.prefs";

interface PrefsContext extends Prefs {
  set: (patch: Partial<Prefs>) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<PrefsContext | null>(null);

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);

  useEffect(() => {
    void kv.getJSON<Partial<Prefs>>(KEY).then((saved) => {
      const browserLocale: Locale = navigator.language?.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
      const next = { ...DEFAULTS, locale: browserLocale, ...saved };
      setPrefs(next);
      applyTheme(next.theme);
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = prefs.locale;
  }, [prefs.locale]);

  const set = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      void kv.setJSON(KEY, next);
      if (patch.theme) applyTheme(patch.theme);
      return next;
    });
  }, []);

  const t = useCallback(
    (key: DictKey, vars?: Record<string, string | number>) =>
      interpolate(dictionaries[prefs.locale][key] ?? dictionaries["pt-BR"][key] ?? key, vars),
    [prefs.locale],
  );

  const value = useMemo(() => ({ ...prefs, set, t }), [prefs, set, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePrefs outside PrefsProvider");
  return ctx;
}

export const useT = () => usePrefs().t;

/** Maps API / worker error codes to friendly copy. */
export function useErrorText() {
  const t = useT();
  return useCallback(
    (code: string | null | undefined) => {
      const key = `error.${code}` as DictKey;
      return key in dictionaries["pt-BR"] ? t(key) : t("error.generic");
    },
    [t],
  );
}
