"use client";

import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { isNative } from "./platform";
import { supabase } from "./supabase";

// O Google recusa login dentro de WebView, então no app o fluxo abre numa Custom Tab
// e volta por este deep link (registrado no AndroidManifest e nas Redirect URLs do Supabase).
const NATIVE_REDIRECT = "app.ayvu://auth";

/** Login com Google. Na web redireciona a página; no app abre o navegador do sistema. */
export async function signInWithGoogle(): Promise<{ error: Error | null }> {
  if (!isNative()) {
    const { error } = await supabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/login/` },
    });
    return { error };
  }
  const { data, error } = await supabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true },
  });
  if (error || !data.url) return { error: error ?? new Error("no oauth url") };
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: data.url, presentationStyle: "popover" });
  return { error: null };
}

/** Troca o ?code= do deep link pela sessão (o code_verifier ficou salvo no Preferences). */
async function completeNativeOAuth(url: string) {
  if (!url.startsWith(NATIVE_REDIRECT)) return;
  const { Browser } = await import("@capacitor/browser");
  void Browser.close().catch(() => {});
  const params = new URL(url.replace(/^app\.ayvu:\/\//, "https://app/")).searchParams;
  const code = params.get("code");
  if (code) await supabase().auth.exchangeCodeForSession(code);
}

interface AuthContext {
  ready: boolean;
  session: Session | null;
  user: User | null;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthContext | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const client = supabase();
    void client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isNative()) return;
    let remove: (() => void) | undefined;
    void import("@capacitor/app").then(async ({ App }) => {
      const handle = await App.addListener("appUrlOpen", ({ url }) => void completeNativeOAuth(url));
      remove = () => void handle.remove();
      // App aberto do zero pelo deep link (processo morto enquanto a Custom Tab estava aberta).
      const launch = await App.getLaunchUrl();
      if (launch?.url) void completeNativeOAuth(launch.url);
    });
    return () => remove?.();
  }, []);

  const value = useMemo<AuthContext>(
    () => ({
      ready,
      session,
      user: session?.user ?? null,
      signOut: async () => {
        await supabase().auth.signOut();
      },
    }),
    [ready, session],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
