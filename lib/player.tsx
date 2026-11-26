"use client";

import { MediaSession } from "@capgo/capacitor-media-session";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useBook, useCoverUrl } from "./books";
import { playableUrl } from "./offline";
import { usePrefs } from "./prefs";
import { loadProgress, saveLocalProgress, syncProgress } from "./progress";
import { supabase } from "./supabase";
import { BOOK_COLUMNS, CHAPTER_COLUMNS, type Book, type Chapter } from "./types";

export const RATES = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];
export type SleepTimer = { mode: "off" } | { mode: "chapter" } | { mode: "time"; endsAt: number; minutes: number };

interface PlayerState {
  book: Book | null;
  chapters: Chapter[];
  chapter: Chapter | null;
  playing: boolean;
  loading: boolean;
  error: boolean;
  waitingNext: boolean;
  position: number;
  duration: number;
  rate: number;
  sleep: SleepTimer;
  expanded: boolean;
}

interface PlayerContext extends PlayerState {
  playBook: (bookId: string, opts?: { chapterIndex?: number }) => Promise<void>;
  toggle: () => void;
  seekBy: (seconds: number) => void;
  seekTo: (seconds: number) => void;
  next: () => void;
  prev: () => void;
  setRate: (rate: number) => void;
  setSleep: (sleep: SleepTimer) => void;
  setExpanded: (expanded: boolean) => void;
  close: () => void;
}

const Ctx = createContext<PlayerContext | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { defaultRate, autoplay, t } = usePrefs();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const revokeRef = useRef<(() => void) | undefined>(undefined);
  const loadSeq = useRef(0);

  const [bookId, setBookId] = useState<string | null>(null);
  const { book, chapters } = useBook(bookId);
  const [chapterIndex, setChapterIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [waitingNext, setWaitingNext] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRateState] = useState(1);
  const [sleep, setSleep] = useState<SleepTimer>({ mode: "off" });
  const [expanded, setExpanded] = useState(false);

  const chapter = useMemo(
    () => chapters.find((c) => c.chapter_index === chapterIndex) ?? null,
    [chapters, chapterIndex],
  );

  // Refs so event handlers always see fresh values without re-binding.
  const live = useRef({ book, chapters, chapter, rate, autoplay, sleep, bookId, chapterIndex });
  useLayoutEffect(() => {
    live.current = { book, chapters, chapter, rate, autoplay, sleep, bookId, chapterIndex };
  });

  // ---------------------------------------------------------------- audio element
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;
    const onTime = () => setPosition(audio.currentTime);
    const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWaiting = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("playing", onCanPlay);
    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------- progress
  const snapshot = useCallback(() => {
    const { bookId: id, chapterIndex: idx, rate: r } = live.current;
    const audio = audioRef.current;
    if (!id || idx == null || !audio) return null;
    return {
      book_id: id,
      chapter_index: idx,
      position_seconds: Math.floor(audio.currentTime),
      playback_rate: r,
      updated_at: new Date().toISOString(),
    };
  }, []);

  const persist = useCallback(
    async (remote: boolean) => {
      const p = snapshot();
      if (!p) return;
      await saveLocalProgress(p);
      if (remote) await syncProgress(p).catch(() => {});
    },
    [snapshot],
  );

  useEffect(() => {
    if (!playing) return;
    let ticks = 0;
    const id = setInterval(() => {
      ticks++;
      void persist(ticks % 4 === 0); // local every 5s, server every 20s
    }, 5000);
    return () => clearInterval(id);
  }, [playing, persist]);

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void persist(true);
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [persist]);

  // ---------------------------------------------------------------- loading chapters
  const loadChapter = useCallback(async (target: Chapter, startAt: number, autoPlay: boolean) => {
    const audio = audioRef.current;
    if (!audio) return;
    const seq = ++loadSeq.current;
    setChapterIndex(target.chapter_index);
    setWaitingNext(false);
    setError(false);
    setLoading(true);
    setPosition(startAt);
    setDuration(target.duration_seconds ?? 0);
    const source = await playableUrl(target);
    if (seq !== loadSeq.current) {
      source?.revoke?.();
      return;
    }
    if (!source) {
      setError(true);
      setLoading(false);
      return;
    }
    revokeRef.current?.();
    revokeRef.current = source.revoke;
    audio.src = source.url;
    audio.playbackRate = live.current.rate;
    const start = () => {
      if (seq !== loadSeq.current) return;
      if (startAt > 0 && startAt < (audio.duration || Infinity) - 1) audio.currentTime = startAt;
      audio.playbackRate = live.current.rate;
      if (autoPlay) audio.play().catch(() => setPlaying(false));
      setLoading(false);
    };
    audio.addEventListener("loadedmetadata", start, { once: true });
    audio.onerror = () => {
      if (seq !== loadSeq.current) return;
      setError(true);
      setLoading(false);
    };
    audio.load();
  }, []);

  const playBook = useCallback(
    async (id: string, opts?: { chapterIndex?: number }) => {
      setExpanded(true);
      if (id === live.current.bookId && opts?.chapterIndex === undefined) {
        audioRef.current?.play().catch(() => {});
        return;
      }
      await persist(true);
      const [{ data: bookRow }, { data: chapterRows }, saved] = await Promise.all([
        supabase().from("books").select(BOOK_COLUMNS).eq("id", id).maybeSingle(),
        supabase().from("chapters").select(CHAPTER_COLUMNS).eq("book_id", id).order("chapter_index"),
        loadProgress(id),
      ]);
      const list = (chapterRows as Chapter[] | null) ?? [];
      if (!bookRow || !list.length) return;
      setBookId(id);
      const savedRate = saved?.playback_rate && RATES.includes(saved.playback_rate) ? saved.playback_rate : defaultRate;
      setRateState(savedRate);
      live.current.rate = savedRate;

      let target: Chapter | undefined;
      let startAt = 0;
      if (opts?.chapterIndex !== undefined) {
        target = list.find((c) => c.chapter_index === opts.chapterIndex);
        if (saved && saved.chapter_index === opts.chapterIndex) startAt = saved.position_seconds;
      } else if (saved) {
        target = list.find((c) => c.chapter_index === saved.chapter_index);
        startAt = saved.position_seconds;
        // Finished that chapter? Start the next one.
        if (target?.duration_seconds && startAt >= target.duration_seconds - 2) {
          target = list.find((c) => c.chapter_index > saved.chapter_index && c.status === "completed") ?? target;
          if (target.chapter_index !== saved.chapter_index) startAt = 0;
        }
      }
      if (!target || target.status !== "completed") {
        target = list.find((c) => c.status === "completed");
        startAt = 0;
      }
      if (!target) return;
      await loadChapter(target, startAt, true);
    },
    [defaultRate, loadChapter, persist],
  );

  const goToChapter = useCallback(
    (direction: 1 | -1) => {
      const { chapters: list, chapterIndex: idx } = live.current;
      if (idx == null) return;
      const pos = list.findIndex((c) => c.chapter_index === idx);
      const target = list[pos + direction];
      if (!target) return;
      void persist(true);
      if (target.status === "completed") void loadChapter(target, 0, true);
      else if (direction === 1) {
        setChapterIndex(target.chapter_index);
        setWaitingNext(true);
        audioRef.current?.pause();
      }
    },
    [loadChapter, persist],
  );

  // Chapter finished: sleep timer, auto-advance, or wait for the next chapter to be generated.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      void persist(true);
      const { sleep: s, autoplay: auto, chapters: list, chapterIndex: idx } = live.current;
      if (s.mode === "chapter") {
        setSleep({ mode: "off" });
        return;
      }
      if (!auto || idx == null) return;
      const nextChapter = list.find((c) => c.chapter_index > idx && c.status !== "cancelled");
      if (!nextChapter) return;
      if (nextChapter.status === "completed") void loadChapter(nextChapter, 0, true);
      else {
        setChapterIndex(nextChapter.chapter_index);
        setWaitingNext(true);
      }
    };
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [loadChapter, persist]);

  // The chapter we were waiting for just finished generating.
  useEffect(() => {
    if (!waitingNext || chapter?.status !== "completed") return;
    const timer = setTimeout(() => void loadChapter(chapter, 0, true), 0);
    return () => clearTimeout(timer);
  }, [waitingNext, chapter, loadChapter]);

  // Sleep timer by time.
  useEffect(() => {
    if (sleep.mode !== "time") return;
    const id = setInterval(() => {
      const left = sleep.endsAt - Date.now();
      const audio = audioRef.current;
      if (!audio) return;
      if (left <= 0) {
        audio.pause();
        audio.volume = 1;
        setSleep({ mode: "off" });
      } else if (left < 10_000) {
        audio.volume = Math.max(0.05, left / 10_000); // gentle fade out
      }
    }, 500);
    return () => clearInterval(id);
  }, [sleep]);

  useEffect(() => {
    if (sleep.mode === "chapter") return;
    if (audioRef.current && sleep.mode === "off") audioRef.current.volume = 1;
  }, [sleep]);

  // ---------------------------------------------------------------- controls
  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    if (audio.paused) audio.play().catch(() => {});
    else {
      audio.pause();
      void persist(true);
    }
  }, [persist]);

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(seconds, (audio.duration || seconds) - 0.25));
    setPosition(audio.currentTime);
  }, []);

  const seekBy = useCallback(
    (delta: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      seekTo(audio.currentTime + delta);
    },
    [seekTo],
  );

  const setRate = useCallback(
    (next: number) => {
      setRateState(next);
      live.current.rate = next;
      if (audioRef.current) audioRef.current.playbackRate = next;
      void persist(false);
    },
    [persist],
  );

  const close = useCallback(() => {
    void persist(true);
    loadSeq.current++;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    revokeRef.current?.();
    setBookId(null);
    setChapterIndex(null);
    setExpanded(false);
    setPlaying(false);
    setWaitingNext(false);
    void MediaSession.setPlaybackState({ playbackState: "none" }).catch(() => {});
  }, [persist]);

  // ---------------------------------------------------------------- lock screen / notification
  const coverUrl = useCoverUrl(book?.cover_path);

  useEffect(() => {
    if (!book || !chapter) return;
    void MediaSession.setMetadata({
      title: chapter.title || t("book.chapter", { index: chapter.chapter_index }),
      artist: book.author ?? book.title,
      album: book.title,
      artwork: coverUrl ? [{ src: coverUrl, sizes: "900x900", type: "image/jpeg" }] : [],
    }).catch(() => {});
  }, [book, chapter, coverUrl, t]);

  useEffect(() => {
    if (!bookId) return;
    void MediaSession.setPlaybackState({ playbackState: playing ? "playing" : "paused" }).catch(() => {});
  }, [playing, bookId]);

  useEffect(() => {
    if (!bookId || !duration) return;
    void MediaSession.setPositionState({ duration, position: Math.min(position, duration), playbackRate: rate }).catch(
      () => {},
    );
    // Position is pushed every few seconds; the OS interpolates in between.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, duration, rate, playing, Math.floor(position / 5)]);

  useEffect(() => {
    const handlers: [Parameters<typeof MediaSession.setActionHandler>[0]["action"], (d: { seekTime?: number | null }) => void][] = [
      ["play", () => audioRef.current?.play().catch(() => {})],
      ["pause", () => toggle()],
      ["seekbackward", () => seekBy(-15)],
      ["seekforward", () => seekBy(30)],
      ["previoustrack", () => goToChapter(-1)],
      ["nexttrack", () => goToChapter(1)],
      ["seekto", (d) => d.seekTime != null && seekTo(d.seekTime)],
      ["stop", () => close()],
    ];
    for (const [action, handler] of handlers) {
      void MediaSession.setActionHandler({ action }, handler).catch(() => {});
    }
  }, [toggle, seekBy, seekTo, goToChapter, close]);

  const value = useMemo<PlayerContext>(
    () => ({
      book: bookId ? (book ?? null) : null,
      chapters,
      chapter,
      playing,
      loading,
      error,
      waitingNext,
      position,
      duration,
      rate,
      sleep,
      expanded,
      playBook,
      toggle,
      seekBy,
      seekTo,
      next: () => goToChapter(1),
      prev: () => {
        // Like most players: restart the chapter unless we're at its very beginning.
        if ((audioRef.current?.currentTime ?? 0) > 5) seekTo(0);
        else goToChapter(-1);
      },
      setRate,
      setSleep,
      setExpanded,
      close,
    }),
    [bookId, book, chapters, chapter, playing, loading, error, waitingNext, position, duration, rate, sleep, expanded, playBook, toggle, seekBy, seekTo, goToChapter, setRate, close],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlayer() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlayer outside PlayerProvider");
  return ctx;
}
