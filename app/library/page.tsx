"use client";

import { BookPlus, Pause, Play, WifiOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Cover } from "@/components/Cover";
import { ProgressBar, StatusPill } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useBooks } from "@/lib/books";
import { humanDuration } from "@/lib/format";
import { usePlayer } from "@/lib/player";
import { usePrefs } from "@/lib/prefs";
import { lastPlayedBookId } from "@/lib/progress";
import type { Book, ListeningProgress } from "@/lib/types";

function greetingKey() {
  const h = new Date().getHours();
  return h < 12 ? "library.greeting.morning" : h < 18 ? "library.greeting.afternoon" : "library.greeting.evening";
}

function listenedFraction(book: Book, progress?: ListeningProgress) {
  if (!progress || !book.total_chapters) return 0;
  return Math.min(1, (progress.chapter_index - 1) / book.total_chapters);
}

export default function LibraryPage() {
  return (
    <AppShell>
      <Library />
    </AppShell>
  );
}

function Library() {
  const { t } = usePrefs();
  const { user } = useAuth();
  const { books, progress, error } = useBooks();
  const player = usePlayer();
  const [lastId, setLastId] = useState<string | null>(null);

  useEffect(() => {
    void lastPlayedBookId().then(setLastId);
  }, [player.book?.id]);

  const featured = useMemo(() => {
    if (!books?.length) return null;
    const playable = books.filter((b) => b.completed_chapters > 0);
    const byProgress = [...playable].sort(
      (a, b) => +new Date(progress[b.id]?.updated_at ?? 0) - +new Date(progress[a.id]?.updated_at ?? 0),
    );
    return playable.find((b) => b.id === lastId) ?? byProgress.find((b) => progress[b.id]) ?? null;
  }, [books, progress, lastId]);

  const name = (user?.user_metadata?.display_name as string | undefined) ?? user?.email?.split("@")[0];

  return (
    <>
      <PageHeader eyebrow={`${t(greetingKey())}${name ? `, ${name}` : ""}`} title={t("library.title")} />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl bg-elevated px-4 py-3 text-sm text-muted">
          <WifiOff className="size-4" /> {t("common.offline")}
        </div>
      )}

      {books === null ? (
        <LibrarySkeleton />
      ) : books.length === 0 ? (
        <EmptyLibrary />
      ) : (
        <div className="flex flex-col gap-9 animate-fade-up">
          {featured && (
            <section>
              <h2 className="eyebrow mb-3">{t("library.continue")}</h2>
              <ContinueCard book={featured} progress={progress[featured.id]} />
            </section>
          )}
          <section>
            <h2 className="eyebrow mb-4">{t("library.all")}</h2>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4">
              {books.map((book) => (
                <li key={book.id}>
                  <BookTile book={book} progress={progress[book.id]} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}

function ContinueCard({ book, progress }: { book: Book; progress?: ListeningProgress }) {
  const { t } = usePrefs();
  const player = usePlayer();
  const isCurrent = player.book?.id === book.id;
  const chapterIndex = isCurrent ? player.chapter?.chapter_index : progress?.chapter_index;
  const remaining = book.total_duration_seconds * (1 - listenedFraction(book, progress));

  return (
    <div className="card relative flex items-center gap-4 overflow-hidden p-4">
      <div className="pointer-events-none absolute -right-20 -top-20 size-60 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]" />
      <Link href={`/book/?id=${book.id}`} className="w-20 shrink-0">
        <Cover title={book.title} author={book.author} coverPath={book.cover_path} size="sm" />
      </Link>
      <div className="relative min-w-0 flex-1">
        <Link href={`/book/?id=${book.id}`}>
          <h3 className="line-clamp-2 font-serif text-lg leading-snug">{book.title}</h3>
        </Link>
        <p className="mt-1 truncate text-sm text-muted">
          {chapterIndex ? t("library.chapterOf", { index: chapterIndex, total: book.total_chapters }) : book.author}
        </p>
        <ProgressBar value={listenedFraction(book, progress)} className="mt-3" />
        {book.status === "completed" && remaining > 60 && (
          <p className="mt-1.5 text-xs text-faint">{t("library.left", { time: humanDuration(remaining) })}</p>
        )}
      </div>
      <button
        className="relative grid size-14 shrink-0 place-items-center rounded-full bg-accent text-accent-ink shadow-soft transition active:scale-95"
        onClick={() => (isCurrent ? player.toggle() : void player.playBook(book.id))}
        aria-label={isCurrent && player.playing ? t("player.pause") : t("book.resume")}
      >
        {isCurrent && player.playing ? <Pause className="size-6 fill-current" /> : <Play className="ml-0.5 size-6 fill-current" />}
      </button>
    </div>
  );
}

function BookTile({ book, progress }: { book: Book; progress?: ListeningProgress }) {
  const fraction = listenedFraction(book, progress);
  const generating = book.status !== "completed";
  return (
    <Link href={`/book/?id=${book.id}`} className="group block">
      <div className="relative transition duration-300 group-hover:-translate-y-1">
        <Cover title={book.title} author={book.author} coverPath={book.cover_path} />
        {progress && fraction > 0 && (
          <div className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-black/40">
            <div className="h-full bg-accent" style={{ width: `${fraction * 100}%` }} />
          </div>
        )}
      </div>
      <h3 className="mt-3 line-clamp-2 text-[14px] font-semibold leading-snug">{book.title}</h3>
      {book.author && <p className="mt-0.5 truncate text-xs text-muted">{book.author}</p>}
      {generating && (
        <div className="mt-2">
          <StatusPill status={book.status} done={book.completed_chapters} total={book.total_chapters} />
        </div>
      )}
    </Link>
  );
}

function EmptyLibrary() {
  const { t } = usePrefs();
  return (
    <div className="card mt-4 flex animate-fade-up flex-col items-center px-6 py-14 text-center">
      <div className="relative mb-7 flex">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-28 w-[72px] rounded-lg border border-line-strong bg-elevated"
            style={{ transform: `rotate(${(i - 1) * 8}deg) translateY(${i === 1 ? -6 : 0}px)`, marginLeft: i ? -18 : 0 }}
          />
        ))}
        <span className="absolute -bottom-3 left-1/2 grid size-11 -translate-x-1/2 place-items-center rounded-full bg-accent text-accent-ink shadow-soft">
          <BookPlus className="size-5" />
        </span>
      </div>
      <h2 className="font-serif text-2xl">{t("library.emptyTitle")}</h2>
      <p className="mt-2 max-w-sm leading-relaxed text-muted">{t("library.emptyBody")}</p>
      <Link href="/add/" className="btn-primary mt-7">
        {t("library.addFirst")}
      </Link>
    </div>
  );
}

function LibrarySkeleton() {
  return (
    <div className="flex flex-col gap-9">
      <div className="card h-28 animate-pulse" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="aspect-[2/3] animate-pulse rounded-xl bg-elevated" />
        ))}
      </div>
    </div>
  );
}
