"use client";

import { kv } from "./platform";
import { supabase } from "./supabase";
import type { ListeningProgress } from "./types";

const LOCAL_KEY = (bookId: string) => `ayvu.progress.${bookId}`;
const PENDING_KEY = "ayvu.progress.pending";
const LAST_BOOK_KEY = "ayvu.lastBook";

export async function saveLocalProgress(p: ListeningProgress) {
  await kv.setJSON(LOCAL_KEY(p.book_id), p);
  await kv.set(LAST_BOOK_KEY, p.book_id);
}

export const lastPlayedBookId = () => kv.get(LAST_BOOK_KEY);

/** The newest of the device copy and the server copy. */
export async function loadProgress(bookId: string): Promise<ListeningProgress | null> {
  const local = await kv.getJSON<ListeningProgress>(LOCAL_KEY(bookId));
  try {
    const { data } = await supabase()
      .from("listening_progress")
      .select("book_id,chapter_index,position_seconds,playback_rate,updated_at")
      .eq("book_id", bookId)
      .maybeSingle();
    const remote = data as ListeningProgress | null;
    if (!local) return remote;
    if (!remote) return local;
    return new Date(remote.updated_at) > new Date(local.updated_at) ? remote : local;
  } catch {
    return local;
  }
}

/** Push to the server; on failure keep it queued and retry on the next sync. */
export async function syncProgress(p: ListeningProgress) {
  const pending = (await kv.getJSON<Record<string, ListeningProgress>>(PENDING_KEY)) ?? {};
  pending[p.book_id] = p;
  const { data } = await supabase().auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;
  const rows = Object.values(pending).map((row) => ({
    user_id: userId,
    book_id: row.book_id,
    chapter_index: row.chapter_index,
    position_seconds: Math.max(0, row.position_seconds),
    playback_rate: row.playback_rate,
    updated_at: row.updated_at,
  }));
  const { error } = await supabase().from("listening_progress").upsert(rows, { onConflict: "user_id,book_id" });
  if (error) {
    // A deleted book makes its row fail the FK forever; drop rows the server rejects as invalid.
    if (error.code === "23503" || error.code === "42501") await kv.remove(PENDING_KEY);
    else await kv.setJSON(PENDING_KEY, pending);
    return;
  }
  await kv.remove(PENDING_KEY);
}
