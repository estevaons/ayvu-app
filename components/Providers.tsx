"use client";

import { useEffect } from "react";
import { AuthProvider } from "@/lib/auth";
import { isNative } from "@/lib/platform";
import { PlayerProvider } from "@/lib/player";
import { PrefsProvider } from "@/lib/prefs";
import { PlayerSheet } from "./Player";
import { ToastProvider } from "./Toaster";

function NativeChrome() {
  useEffect(() => {
    // Também no APK: ele carrega o site publicado, e sem cache não abriria offline
    // para tocar os livros baixados.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("[ayvu] offline mode unavailable", err));
    }
    if (!isNative()) return;
    void (async () => {
      const [{ StatusBar, Style }, { SplashScreen }] = await Promise.all([
        import("@capacitor/status-bar"),
        import("@capacitor/splash-screen"),
      ]);
      const dark = !document.documentElement.matches('[data-theme="light"]') &&
        !(window.matchMedia("(prefers-color-scheme: light)").matches && !document.documentElement.matches('[data-theme="dark"]'));
      await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
      await SplashScreen.hide().catch(() => {});
    })();
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrefsProvider>
      <ToastProvider>
        <AuthProvider>
          <PlayerProvider>
            <NativeChrome />
            {children}
            <PlayerSheet />
          </PlayerProvider>
        </AuthProvider>
      </ToastProvider>
    </PrefsProvider>
  );
}
