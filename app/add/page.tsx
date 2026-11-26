"use client";

import { BookOpen, FileText, Headphones, Sparkles, UploadCloud, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { useToast } from "@/components/Toaster";
import { ProgressBar, Spinner } from "@/components/ui";
import { ApiError, api, removeUpload, uploadSource } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bytes } from "@/lib/format";
import { useErrorText, usePrefs } from "@/lib/prefs";
import { LANGUAGES, voiceLabel } from "@/lib/voices";

const MAX_BYTES = 50 * 1024 * 1024;
const EXTENSIONS = ["pdf", "epub", "mobi", "azw", "azw3", "txt"];
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  epub: "application/epub+zip",
  mobi: "application/x-mobipocket-ebook",
  azw: "application/vnd.amazon.ebook",
  azw3: "application/vnd.amazon.ebook",
  txt: "text/plain",
};

const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

export default function AddPage() {
  return (
    <AppShell>
      <AddBook />
    </AppShell>
  );
}

function AddBook() {
  const { t, locale } = usePrefs();
  const errorText = useErrorText();
  const toast = useToast();
  const router = useRouter();
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("");
  const [voice, setVoice] = useState("");
  const [phase, setPhase] = useState<"idle" | "uploading" | "creating">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const voices = LANGUAGES.find((l) => l.code === language)?.voices ?? [];

  function pick(candidate: File | undefined) {
    setError(null);
    if (!candidate) return;
    if (!EXTENSIONS.includes(extOf(candidate.name))) return setError(t("add.badFormat"));
    if (candidate.size > MAX_BYTES) return setError(t("add.tooLarge"));
    setFile(candidate);
  }

  async function submit() {
    if (!file || !user) return;
    setError(null);
    const ext = extOf(file.name);
    const bookId = crypto.randomUUID();
    const path = `${user.id}/${bookId}/source.${ext}`;
    abortRef.current = new AbortController();
    let uploaded = false;
    try {
      setPhase("uploading");
      setProgress(0);
      const typed = file.type ? file : new File([file], file.name, { type: MIME[ext] });
      await uploadSource(typed, path, setProgress, abortRef.current.signal);
      uploaded = true;
      setPhase("creating");
      const book = await api.createBook({
        source_path: path,
        filename: file.name,
        title: title.trim() || undefined,
        language: language || undefined,
        voice: voice || undefined,
      });
      router.push(`/book/?id=${book.id}`);
    } catch (err) {
      // A 4xx means the API refused before creating the book, so the upload is safe to drop.
      // On a network error or 5xx the book may exist already and still needs its file.
      const refused = err instanceof ApiError && err.status >= 400 && err.status < 500;
      if (uploaded && refused) void removeUpload(path);
      const code = err instanceof ApiError ? err.code : "generic";
      if (code !== "aborted") {
        console.error("[ayvu] add book failed", err);
        setError(errorText(code));
        toast(errorText(code), "error");
      }
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";

  return (
    <>
      <PageHeader title={t("add.title")} />
      <div className="grid grid-cols-1 gap-8 animate-fade-up md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Drop zone / selected file */}
          {!file ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files?.[0]);
              }}
              className={`flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed px-5 py-10 text-center transition sm:px-6 sm:py-14 ${
                dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:border-accent/60"
              }`}
            >
              <span className="grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
                <UploadCloud className="size-7" />
              </span>
              <span className="text-lg font-semibold">{t("add.drop")}</span>
              {/* Arrastar e soltar não existe no celular. */}
              <span className="text-sm text-muted pointer-coarse:hidden">{t("add.dropHint")}</span>
              <span className="mt-2 text-xs text-faint">{t("add.subtitle")}</span>
            </button>
          ) : (
            <div className="card flex items-center gap-4 p-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
                <FileText className="size-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{file.name}</p>
                <p className="text-sm text-muted">
                  {extOf(file.name).toUpperCase()} · {bytes(file.size)}
                </p>
              </div>
              {!busy && (
                <button className="icon-btn" onClick={() => setFile(null)} aria-label={t("add.replace")}>
                  <X className="size-5" />
                </button>
              )}
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            hidden
            accept={EXTENSIONS.map((e) => `.${e}`).join(",")}
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          <div className="flex flex-col gap-4">
            <div>
              <label className="label" htmlFor="title">{t("add.bookTitle")}</label>
              <input
                id="title"
                className="field"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("add.titlePlaceholder")}
                disabled={busy}
                maxLength={300}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="language">{t("add.language")}</label>
                <select
                  id="language"
                  className="field appearance-none"
                  value={language}
                  onChange={(e) => {
                    setLanguage(e.target.value);
                    setVoice("");
                  }}
                  disabled={busy}
                >
                  <option value="">{t("add.auto")}</option>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>{l.label[locale]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="voice">{t("add.voice")}</label>
                <select
                  id="voice"
                  className="field appearance-none"
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  disabled={busy || !language}
                >
                  <option value="">{t("add.voiceDefault")}</option>
                  {voices.map((v) => (
                    <option key={v} value={v}>{voiceLabel(v, locale)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}

          {phase === "uploading" ? (
            <div className="card p-4">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="font-medium">{t("add.uploading", { percent: Math.round(progress * 100) })}</span>
                <button className="text-muted hover:text-ink" onClick={() => abortRef.current?.abort()}>
                  {t("common.cancel")}
                </button>
              </div>
              <ProgressBar value={progress} />
            </div>
          ) : (
            <button className="btn-primary h-13 text-base" disabled={!file || busy} onClick={submit}>
              {phase === "creating" ? (
                <>
                  <Spinner className="size-5" /> {t("add.creating")}
                </>
              ) : (
                t("add.submit")
              )}
            </button>
          )}
          <p className="text-center text-xs text-faint">{t("add.drmNote")}</p>
        </div>

        {/* How it works: no celular vem depois do formulário, que é a ação principal. */}
        <aside className="min-w-0">
          <ol className="flex flex-col gap-3 md:gap-5">
            {[
              { icon: BookOpen, text: t("add.how1") },
              { icon: Sparkles, text: t("add.how2") },
              { icon: Headphones, text: t("add.how3") },
            ].map(({ icon: Icon, text }, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-elevated text-accent">
                  <Icon className="size-4.5" />
                </span>
                <span className="pt-1.5 text-sm leading-snug text-muted">{text}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </>
  );
}
