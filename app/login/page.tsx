"use client";

import { ArrowRight, BookOpen, Headphones, MailCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useToast } from "@/components/Toaster";
import { Logo, Spinner } from "@/components/ui";
import { signInWithGoogle, useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { supabase } from "@/lib/supabase";

type Mode = "signIn" | "signUp";

export default function LoginPage() {
  const { t } = usePrefs();
  const { ready, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSentTo, setConfirmSentTo] = useState<string | null>(null);

  useEffect(() => {
    if (ready && user) router.replace("/library/");
  }, [ready, user, router]);

  async function google() {
    setError(null);
    setGoogleBusy(true);
    const { error } = await signInWithGoogle();
    if (error) setError(t("auth.generic"));
    // Na web a página sai daqui; no app a Custom Tab fica por cima, então liberamos o botão.
    setTimeout(() => setGoogleBusy(false), 1500);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signIn") {
        const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
        if (error) {
          setError(
            error.code === "email_not_confirmed"
              ? t("auth.notConfirmed")
              : error.code === "invalid_credentials"
                ? t("auth.invalid")
                : t("auth.generic"),
          );
        }
      } else {
        if (password.length < 8) {
          setError(t("auth.weak"));
          return;
        }
        const { data, error } = await supabase().auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: name.trim() || undefined },
            emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/library/` : undefined,
          },
        });
        if (error) {
          setError(
            error.code === "user_already_exists" ? t("auth.exists") : error.code === "weak_password" ? t("auth.weak") : t("auth.generic"),
          );
        } else if (!data.session) {
          setConfirmSentTo(email.trim());
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!email.trim()) {
      setError(t("auth.email"));
      return;
    }
    await supabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/settings/`,
    });
    toast(t("auth.resetSent"), "success");
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel (wide screens) */}
      <aside className="relative hidden overflow-hidden border-r border-line bg-surface p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -left-40 -top-40 size-[600px] rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]" />
        <Logo />
        <div className="relative max-w-md">
          <p className="font-serif text-5xl leading-[1.05] tracking-tight">
            {t("app.tagline")}
          </p>
          <ul className="mt-10 flex flex-col gap-5 text-muted">
            {[
              { icon: BookOpen, text: t("add.how1") },
              { icon: Sparkles, text: t("add.how2") },
              { icon: Headphones, text: t("add.how3") },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-elevated text-accent">
                  <Icon className="size-5" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-faint">PDF · EPUB · MOBI · AZW3 · TXT</p>
      </aside>

      <section className="flex flex-col justify-center px-6 pt-safe pb-safe">
        <div className="mx-auto w-full max-w-sm py-10">
          <Logo className="mb-12 lg:hidden" />

          {confirmSentTo ? (
            <div className="animate-fade-up">
              <span className="mb-6 grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
                <MailCheck className="size-7" />
              </span>
              <h1 className="font-serif text-3xl">{t("auth.checkEmail")}</h1>
              <p className="mt-3 leading-relaxed text-muted">{t("auth.checkEmailBody", { email: confirmSentTo })}</p>
              <button
                className="btn-secondary mt-8 w-full"
                onClick={() => {
                  setConfirmSentTo(null);
                  setMode("signIn");
                }}
              >
                {t("auth.signIn")}
              </button>
            </div>
          ) : (
            <div className="animate-fade-up" key={mode}>
              <h1 className="font-serif text-[34px] leading-tight tracking-tight">
                {mode === "signIn" ? t("auth.welcome") : t("auth.welcomeNew")}
              </h1>
              <p className="mt-2 text-muted">{t("auth.subtitle")}</p>

              <button type="button" onClick={google} className="btn-secondary mt-9 h-12 w-full" disabled={googleBusy}>
                {googleBusy ? <Spinner className="size-5" /> : (
                  <>
                    <GoogleIcon className="size-5" />
                    {t("auth.google")}
                  </>
                )}
              </button>

              <div className="my-6 flex items-center gap-4 text-xs uppercase tracking-wider text-faint">
                <span className="h-px flex-1 bg-line" />
                {t("auth.or")}
                <span className="h-px flex-1 bg-line" />
              </div>

              <form onSubmit={submit} className="flex flex-col gap-4">
                {mode === "signUp" && (
                  <div>
                    <label className="label" htmlFor="name">{t("auth.name")}</label>
                    <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
                  </div>
                )}
                <div>
                  <label className="label" htmlFor="email">{t("auth.email")}</label>
                  <input
                    id="email"
                    type="email"
                    required
                    className="field"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    inputMode="email"
                  />
                </div>
                <div>
                  <div className="flex items-baseline justify-between">
                    <label className="label" htmlFor="password">{t("auth.password")}</label>
                    {mode === "signIn" && (
                      <button type="button" onClick={forgot} className="text-xs font-medium text-accent hover:underline">
                        {t("auth.forgot")}
                      </button>
                    )}
                  </div>
                  <input
                    id="password"
                    type="password"
                    required
                    minLength={mode === "signUp" ? 8 : undefined}
                    className="field"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === "signIn" ? "current-password" : "new-password"}
                    placeholder={mode === "signUp" ? t("auth.passwordHint") : undefined}
                  />
                </div>

                {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}

                <button type="submit" className="btn-primary mt-2 h-12" disabled={busy}>
                  {busy ? <Spinner className="size-5" /> : (
                    <>
                      {mode === "signIn" ? t("auth.signIn") : t("auth.signUp")}
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </button>
              </form>

              <p className="mt-8 text-center text-sm text-muted">
                {mode === "signIn" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
                <button
                  className="font-semibold text-accent hover:underline"
                  onClick={() => {
                    setMode(mode === "signIn" ? "signUp" : "signIn");
                    setError(null);
                  }}
                >
                  {mode === "signIn" ? t("auth.signUp") : t("auth.signIn")}
                </button>
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
