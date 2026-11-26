import type { CapacitorConfig } from "@capacitor/cli";

// O APK abre o site publicado na Vercel: cada deploy chega ao app na hora, sem rebuild.
// Só é preciso gerar outro APK ao trocar de domínio, de plugin nativo ou de ícone/splash,
// porque o endereço e o código nativo vão dentro do instalador.
const site = process.env.APP_SITE_URL ?? "https://ayvu-app.vercel.app";

const config: CapacitorConfig = {
  appId: "app.ayvu",
  appName: "Ayvu",
  webDir: "out",
  backgroundColor: "#0f0e0c",
  server: {
    url: site,
    // Só um build de teste apontando para o computador (http://IP:3000) precisa de http puro.
    cleartext: site.startsWith("http://"),
    // Navegação permitida dentro do app; o resto abre no navegador do sistema.
    allowNavigation: [new URL(site).hostname, "gsttfhqvqtpowyxybgtw.supabase.co"],
    // Sem internet e sem a página em cache: tela local com "tentar de novo".
    errorPath: "/offline.html",
  },
  android: {
    // Audio keeps playing with the screen off; the media-session plugin runs the foreground service.
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      // Quem esconde é o app (Providers) quando já há interface; a página offline também esconde.
      launchAutoHide: false,
      backgroundColor: "#0f0e0c",
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: true,
      backgroundColor: "#00000000",
    },
  },
};

export default config;
