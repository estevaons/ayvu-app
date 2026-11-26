"use client";

import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { isNative, kv } from "./platform";
import { signedUrl } from "./supabase";
import type { Chapter } from "./types";

const INDEX_KEY = "ayvu.offline.v1";
const CACHE_NAME = "ayvu-audio-v1";

export interface OfflineEntry {
  bookId: string;
  chapterIndex: number;
  audioPath: string; // remote path; a regenerated chapter gets the same path, so we also keep size
  size: number;
  uri?: string; // native file uri
}

type Index = Record<string, OfflineEntry>; // by chapter id

let indexCache: Index | null = null;
const listeners = new Set<() => void>();

async function readIndex(): Promise<Index> {
  if (!indexCache) indexCache = (await kv.getJSON<Index>(INDEX_KEY)) ?? {};
  return indexCache;
}

async function writeIndex(index: Index) {
  indexCache = index;
  await kv.setJSON(INDEX_KEY, index);
  listeners.forEach((fn) => fn());
}

export function onOfflineChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export async function offlineIndex(): Promise<Index> {
  return { ...(await readIndex()) };
}

export async function isChapterOffline(chapter: Chapter) {
  const entry = (await readIndex())[chapter.id];
  return !!entry && entry.size === chapter.size_bytes;
}

export async function downloadChapter(chapter: Chapter): Promise<void> {
  if (!chapter.audio_path || chapter.status !== "completed") return;
  if (await isChapterOffline(chapter)) return;
  const url = await signedUrl("audio", chapter.audio_path);
  if (!url) throw new Error("no_url");
  const entry: OfflineEntry = {
    bookId: chapter.book_id,
    chapterIndex: chapter.chapter_index,
    audioPath: chapter.audio_path,
    size: chapter.size_bytes ?? 0,
  };
  if (isNative()) {
    const res = await Filesystem.downloadFile({
      url,
      path: `audio/${chapter.book_id}/${chapter.chapter_index}.mp3`,
      directory: Directory.Data,
      recursive: true,
    });
    entry.uri = res.path ?? (await Filesystem.getUri({ directory: Directory.Data, path: `audio/${chapter.book_id}/${chapter.chapter_index}.mp3` })).uri;
  } else {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`download_failed_${response.status}`);
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheKey(chapter.id), response);
  }
  const index = await readIndex();
  await writeIndex({ ...index, [chapter.id]: entry });
}

export async function downloadBook(chapters: Chapter[], onProgress?: (done: number, total: number) => void) {
  const ready = chapters.filter((c) => c.status === "completed" && c.audio_path);
  let done = 0;
  onProgress?.(done, ready.length);
  for (const chapter of ready) {
    await downloadChapter(chapter);
    onProgress?.(++done, ready.length);
  }
}

export async function removeBookDownloads(bookId: string) {
  const index = await readIndex();
  const next: Index = {};
  for (const [id, entry] of Object.entries(index)) {
    if (entry.bookId !== bookId) {
      next[id] = entry;
      continue;
    }
    await removeFile(id, entry);
  }
  await writeIndex(next);
}

export async function clearAllDownloads() {
  const index = await readIndex();
  for (const [id, entry] of Object.entries(index)) await removeFile(id, entry);
  await writeIndex({});
}

async function removeFile(chapterId: string, entry: OfflineEntry) {
  try {
    if (isNative()) {
      await Filesystem.deleteFile({ path: `audio/${entry.bookId}/${entry.chapterIndex}.mp3`, directory: Directory.Data });
    } else {
      await (await caches.open(CACHE_NAME)).delete(cacheKey(chapterId));
    }
  } catch {
    /* already gone */
  }
}

const cacheKey = (chapterId: string) => `/offline-audio/${chapterId}.mp3`;

/** A URL the <audio> element can play: local copy first, then a signed stream URL. */
export async function playableUrl(chapter: Chapter): Promise<{ url: string; revoke?: () => void } | null> {
  const entry = (await readIndex())[chapter.id];
  if (entry && entry.size === chapter.size_bytes) {
    if (isNative() && entry.uri) return { url: Capacitor.convertFileSrc(entry.uri) };
    if (!isNative()) {
      const hit = await (await caches.open(CACHE_NAME)).match(cacheKey(chapter.id));
      if (hit) {
        const url = URL.createObjectURL(await hit.blob());
        return { url, revoke: () => URL.revokeObjectURL(url) };
      }
    }
  }
  if (!chapter.audio_path) return null;
  const url = await signedUrl("audio", chapter.audio_path);
  return url ? { url } : null;
}
