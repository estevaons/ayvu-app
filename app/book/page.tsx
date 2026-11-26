"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleDashed,
  CloudDownload,
  Loader2,
  MoreHorizontal,
  Pause,
  PauseCircle,
  Pencil,
  Play,
  PlayCircle,
  RefreshCw,
  Trash2,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Cover } from "@/components/Cover";
import { useToast } from "@/components/Toaster";
import { ConfirmSheet, ProgressBar, Sheet, Spinner, StatusPill } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useBook } from "@/lib/books";
import { clock, humanDuration } from "@/lib/format";
import { downloadBook, offlineIndex, onOfflineChange, removeBookDownloads } from "@/lib/offline";
import { usePlayer } from "@/lib/player";
import { useErrorText, usePrefs } from "@/lib/prefs";
import { loadProgress } from "@/lib/progress";
import type { Chapter, ListeningProgress } from "@/lib/types";
import { languageLabel, voiceLabel } from "@/lib/voices";

export default function BookPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="py-20 text-center"><Spinner className="mx-auto size-6" /></div>}>
        <BookDetail />
      </Suspense>
    </AppShell>
  );
}

function useOfflineChapters(bookId: string | null) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!bookId) return;
    const refresh = () =>
      void offlineIndex().then((index) =>
        setIds(new Set(Object.entries(index).filter(([, e]) => e.bookId === bookId).map(([id]) => id))),
      );
    refresh();
    return onOfflineChange(refresh);
  }, [bookId]);
  return ids;
}

function BookDetail() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const { t, locale } = usePrefs();
  const errorText = useErrorText();
  const toast = useToast();
  const player = usePlayer();
  const { book, chapters } = useBook(id);
  const offline = useOfflineChapters(id);
  const [saved, setSaved] = useState<ListeningProgress | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState<null | "retry" | "cancel" | "delete" | "rename">(null);
  const [download, setDownload] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (id) void loadProgress(id).then(setSaved);
  }, [id, player.chapter?.chapter_index]);

  const isCurrent = player.book?.id === id;
  const ready = chapters.filter((c) => c.status === "completed");
  const allOffline = ready.length > 0 && ready.every((c) => offline.has(c.id));

  const run = useCallback(
    async (kind: NonNullable<typeof busy>, fn: () => Promise<unknown>) => {
      setBusy(kind);
      try {
        await fn();
        return true;
      } catch (err) {
        toast(errorText(err instanceof ApiError ? err.code : "generic"), "error");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [toast, errorText],
  );

  const failed = useMemo(() => chapters.filter((c) => c.status === "failed").length, [chapters]);

  if (book === undefined) {
    return <div className="py-24 text-center"><Spinner className="mx-auto size-6 text-muted" /></div>;
  }
  if (book === null || !id) {
    return (
      <div className="py-24 text-center">
        <p className="text-muted">{t("book.notFound")}</p>
        <Link href="/library/" className="btn-secondary mt-6">{t("common.back")}</Link>
      </div>
    );
  }

  const active = ["uploaded", "preparing", "queued", "generating"].includes(book.status);
  const generationFraction = book.total_chapters ? book.completed_chapters / book.total_chapters : 0;

  async function onDownload() {
    if (allOffline) {
      await removeBookDownloads(id!);
      return;
    }
    setDownload({ done: 0, total: ready.length });
    try {
      await downloadBook(chapters, (done, total) => setDownload({ done, total }));
    } catch {
      toast(errorText("network"), "error");
    } finally {
      setDownload(null);
    }
  }

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between pt-3 pb-2">
        <button className="icon-btn -ml-2" onClick={() => (history.length > 1 ? router.back() : router.push("/library/"))} aria-label={t("common.back")}>
          <ArrowLeft className="size-5" />
        </button>
        <button className="icon-btn -mr-2" onClick={() => setMenu(true)} aria-label={t("book.more")}>
          <MoreHorizontal className="size-5" />
        </button>
      </div>

      {/* Hero */}
      <section className="flex flex-col items-center gap-6 pt-2 pb-8 text-center sm:flex-row sm:items-end sm:text-left">
        <Cover title={book.title} author={book.author} coverPath={book.cover_path} size="lg" className="w-44 shrink-0 sm:w-48" />
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex justify-center sm:justify-start">
            <StatusPill status={book.status} done={book.completed_chapters} total={book.total_chapters} />
          </div>
          <h1 className="font-serif text-3xl leading-tight tracking-tight sm:text-4xl">{book.title}</h1>
          {book.author && <p className="mt-1.5 text-muted">{book.author}</p>}
          <dl className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm text-muted sm:justify-start">
            {book.total_chapters > 0 && <div>{t("book.chaptersCount", { count: book.total_chapters })}</div>}
            {book.total_duration_seconds > 0 && <div>{humanDuration(book.total_duration_seconds)}</div>}
            {book.language_code && <div>{languageLabel(book.language_code, locale)}</div>}
            {book.voice && (
              <div className="inline-flex items-center gap-1">
                <Volume2 className="size-3.5" />
                {voiceLabel(book.voice, locale).split(" · ")[0]}
              </div>
            )}
          </dl>
        </div>
      </section>

      {/* Primary actions */}
      <div className="flex flex-wrap gap-3">
        <button
          className="btn-primary h-12 flex-1 sm:flex-none sm:px-8"
          disabled={ready.length === 0}
          onClick={() => (isCurrent ? player.toggle() : void player.playBook(book.id))}
        >
          {isCurrent && player.playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 fill-current" />}
          {isCurrent && player.playing ? t("player.pause") : saved ? t("book.resume") : t("book.play")}
        </button>
        {ready.length > 0 && (
          <button className="btn-secondary h-12" onClick={onDownload} disabled={!!download}>
            {download ? (
              <>
                <Spinner className="size-4" /> {t("book.downloading", download)}
              </>
            ) : allOffline ? (
              <>
                <Check className="size-4 text-success" /> {t("book.downloaded")}
              </>
            ) : (
              <>
                <CloudDownload className="size-4" /> {t("book.download")}
              </>
            )}
          </button>
        )}
      </div>

      {/* Status panel */}
      {book.status === "failed" && (
        <div className="mt-6 flex gap-3 rounded-3xl bg-danger-soft p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="flex-1">
            <p className="text-[15px] text-ink">
              {book.total_chapters === 0 ? errorText(book.error_code) : t("book.failedChapters", { count: failed })}
            </p>
            <button
              className="btn mt-3 h-9 bg-danger px-4 text-sm text-white"
              disabled={busy === "retry"}
              onClick={() => run("retry", () => api.retryBook(book.id))}
            >
              {busy === "retry" ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
              {book.total_chapters === 0 ? t("common.retry") : t("book.retryFailed")}
            </button>
          </div>
        </div>
      )}
      {active && (
        <div className="card mt-6 p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 shrink-0 animate-spin text-accent" />
            <p className="flex-1 text-[15px]">
              {book.status === "preparing" || book.status === "uploaded"
                ? t("book.preparing")
                : book.status === "queued" && book.completed_chapters === 0
                  ? t("book.queued")
                  : ready.length > 0
                    ? t("book.listenNow")
                    : t("book.generatingHint")}
            </p>
          </div>
          {book.total_chapters > 0 && (
            <>
              <ProgressBar value={generationFraction} className="mt-4" />
              <p className="mt-2 text-xs text-muted">
                {t("status.progress", { done: book.completed_chapters, total: book.total_chapters })}
              </p>
            </>
          )}
        </div>
      )}

      {/* Chapters */}
      {chapters.length > 0 && (
        <section className="mt-10">
          <h2 className="eyebrow mb-3">{t("book.chapters")}</h2>
          <ol className="card divide-y divide-line overflow-hidden">
            {chapters.map((c) => (
              <ChapterRow
                key={c.id}
                chapter={c}
                current={isCurrent && player.chapter?.chapter_index === c.chapter_index}
                playing={isCurrent && player.playing && player.chapter?.chapter_index === c.chapter_index}
                listened={!!saved && c.chapter_index < saved.chapter_index}
                offline={offline.has(c.id)}
                onPlay={() =>
                  isCurrent && player.chapter?.chapter_index === c.chapter_index
                    ? player.toggle()
                    : void player.playBook(c.book_id, { chapterIndex: c.chapter_index })
                }
              />
            ))}
          </ol>
        </section>
      )}

      {/* Menu */}
      <Sheet open={menu} onClose={() => setMenu(false)}>
        <div className="flex flex-col gap-1">
          <MenuItem icon={Pencil} label={t("book.rename")} onClick={() => { setMenu(false); setNewTitle(book.title); setRenaming(true); }} />
          {active && (
            <MenuItem
              icon={PauseCircle}
              label={t("book.cancel")}
              onClick={async () => {
                setMenu(false);
                await run("cancel", () => api.cancelBook(book.id));
              }}
            />
          )}
          {book.status === "cancelled" && (
            <MenuItem
              icon={PlayCircle}
              label={t("book.resumeGeneration")}
              onClick={async () => {
                setMenu(false);
                await run("retry", () => api.retryBook(book.id));
              }}
            />
          )}
          {offline.size > 0 && (
            <MenuItem icon={CloudDownload} label={t("book.removeDownload")} onClick={() => { setMenu(false); void removeBookDownloads(book.id); }} />
          )}
          <MenuItem icon={Trash2} danger label={t("book.delete")} onClick={() => { setMenu(false); setConfirmDelete(true); }} />
        </div>
      </Sheet>

      <Sheet open={renaming} onClose={() => setRenaming(false)} title={t("book.rename")}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newTitle.trim()) return;
            if (await run("rename", () => api.renameBook(book.id, newTitle.trim()))) setRenaming(false);
          }}
          className="flex flex-col gap-4"
        >
          <input className="field" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} autoFocus maxLength={300} />
          <button className="btn-primary" disabled={busy === "rename" || !newTitle.trim()}>
            {busy === "rename" ? <Spinner className="size-4" /> : t("common.save")}
          </button>
        </form>
      </Sheet>

      <ConfirmSheet
        open={confirmDelete}
        title={t("book.deleteTitle", { title: book.title })}
        body={t("book.deleteBody")}
        confirmLabel={t("common.delete")}
        danger
        busy={busy === "delete"}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (isCurrent) player.close();
          await removeBookDownloads(book.id);
          if (await run("delete", () => api.deleteBook(book.id))) router.replace("/library/");
        }}
      />
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-13 items-center gap-3 rounded-2xl px-3 text-left text-[15px] hover:bg-elevated ${danger ? "text-danger" : ""}`}
    >
      <Icon className="size-5" />
      {label}
    </button>
  );
}

function ChapterRow({
  chapter,
  current,
  playing,
  listened,
  offline,
  onPlay,
}: {
  chapter: Chapter;
  current: boolean;
  playing: boolean;
  listened: boolean;
  offline: boolean;
  onPlay: () => void;
}) {
  const { t } = usePrefs();
  const ready = chapter.status === "completed";
  return (
    <li>
      <button
        onClick={onPlay}
        disabled={!ready}
        className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-elevated disabled:hover:bg-transparent ${current ? "bg-accent-soft" : ""}`}
      >
        <span className={`grid size-9 shrink-0 place-items-center rounded-full ${current ? "bg-accent text-accent-ink" : "bg-elevated text-muted"}`}>
          {playing ? (
            <Pause className="size-4 fill-current" />
          ) : ready ? (
            <Play className="ml-0.5 size-4 fill-current" />
          ) : chapter.status === "generating" ? (
            <Loader2 className="size-4 animate-spin text-accent" />
          ) : chapter.status === "failed" ? (
            <AlertTriangle className="size-4 text-danger" />
          ) : (
            <CircleDashed className="size-4" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] ${current ? "font-semibold text-accent" : listened ? "text-muted" : ""} ${!ready ? "text-faint" : ""}`}>
            {chapter.title || t("book.chapter", { index: chapter.chapter_index })}
          </span>
          <span className="block text-xs text-faint">
            {chapter.title ? `${t("book.chapter", { index: chapter.chapter_index })} · ` : ""}
            {ready && chapter.duration_seconds
              ? clock(chapter.duration_seconds)
              : chapter.status === "generating"
                ? t("book.generatingNow")
                : chapter.status === "failed"
                  ? t("status.failed")
                  : t("book.waiting")}
          </span>
        </span>
        {offline && <CloudDownload className="size-4 shrink-0 text-success" aria-label={t("book.downloaded")} />}
        {listened && !current && <Check className="size-4 shrink-0 text-faint" />}
      </button>
    </li>
  );
}
