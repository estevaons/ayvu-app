"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth";
import { signedUrl, supabase } from "./supabase";
import { BOOK_COLUMNS, CHAPTER_COLUMNS, type Book, type Chapter, type ListeningProgress } from "./types";

async function fetchLibrary() {
  const client = supabase();
  const [booksRes, progressRes] = await Promise.all([
    client.from("books").select(BOOK_COLUMNS).order("created_at", { ascending: false }),
    client.from("listening_progress").select("book_id,chapter_index,position_seconds,playback_rate,updated_at"),
  ]);
  if (booksRes.error) return null;
  return {
    books: booksRes.data as Book[],
    progress: Object.fromEntries((progressRes.data ?? []).map((p) => [p.book_id, p as ListeningProgress])),
  };
}

/** All of the user's books, kept live via Realtime. */
export function useBooks() {
  const { user } = useAuth();
  const [books, setBooks] = useState<Book[] | null>(null);
  const [progress, setProgress] = useState<Record<string, ListeningProgress>>({});
  const [error, setError] = useState(false);

  const reload = useCallback(() => {
    void fetchLibrary().then((res) => {
      setError(!res);
      if (!res) return;
      setBooks(res.books);
      setProgress(res.progress);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    reload();
    const channel = supabase()
      .channel(`books:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "books", filter: `user_id=eq.${user.id}` }, (payload) => {
        setBooks((prev) => {
          if (!prev) return prev;
          if (payload.eventType === "DELETE") return prev.filter((b) => b.id !== (payload.old as Book).id);
          const row = payload.new as Book;
          const idx = prev.findIndex((b) => b.id === row.id);
          if (idx === -1) return [row, ...prev];
          const next = prev.slice();
          next[idx] = { ...next[idx], ...row };
          return next;
        });
      })
      .subscribe();
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener("focus", reload);
      void supabase().removeChannel(channel);
    };
  }, [user, reload]);

  return { books, progress, error, reload };
}

async function fetchBook(id: string) {
  const client = supabase();
  const [b, c] = await Promise.all([
    client.from("books").select(BOOK_COLUMNS).eq("id", id).maybeSingle(),
    client.from("chapters").select(CHAPTER_COLUMNS).eq("book_id", id).order("chapter_index"),
  ]);
  return { book: (b.data as Book | null) ?? null, chapters: (c.data as Chapter[]) ?? [] };
}

/** One book with its chapters, kept live via Realtime. `book` is undefined while loading. */
export function useBook(id: string | null) {
  const [state, setState] = useState<{ id: string | null; book: Book | null | undefined; chapters: Chapter[] }>({
    id: null,
    book: undefined,
    chapters: [],
  });

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void fetchBook(id).then((res) => alive && setState({ id, ...res }));
    const channel = supabase()
      .channel(`book:${id}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "books", filter: `id=eq.${id}` }, (payload) => {
        setState((prev) => {
          if (prev.id !== id) return prev;
          if (payload.eventType === "DELETE") return { ...prev, book: null };
          return { ...prev, book: { ...(prev.book ?? {}), ...(payload.new as Book) } };
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chapters", filter: `book_id=eq.${id}` }, (payload) => {
        setState((prev) => {
          if (prev.id !== id) return prev;
          if (payload.eventType === "DELETE") {
            return { ...prev, chapters: prev.chapters.filter((c) => c.id !== (payload.old as Chapter).id) };
          }
          const row = payload.new as Chapter;
          const idx = prev.chapters.findIndex((c) => c.id === row.id);
          const next = idx === -1 ? [...prev.chapters, row] : prev.chapters.map((c, i) => (i === idx ? { ...c, ...row } : c));
          return { ...prev, chapters: next.sort((a, b) => a.chapter_index - b.chapter_index) };
        });
      })
      .subscribe();
    return () => {
      alive = false;
      void supabase().removeChannel(channel);
    };
  }, [id]);

  if (!id) return { book: null, chapters: [] as Chapter[] };
  if (state.id !== id) return { book: undefined, chapters: [] as Chapter[] };
  return { book: state.book, chapters: state.chapters };
}

export function useCoverUrl(path: string | null | undefined) {
  const [state, setState] = useState<{ path: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    void signedUrl("covers", path).then((url) => alive && setState({ path, url }));
    return () => {
      alive = false;
    };
  }, [path]);
  return path && state?.path === path ? state.url : null;
}
