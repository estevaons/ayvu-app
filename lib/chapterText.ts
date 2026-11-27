"use client";

import { supabase } from "./supabase";
import type { Chapter } from "./types";

/** One stretch of narration: what was said between `start` and `end` (seconds). */
export interface Segment {
  start: number;
  end: number;
  text: string;
}

/** The chapter as the player shows it: paragraphs of timed segments. */
export type Script = Segment[][];

export interface ChapterTextRow {
  content: string;
  timings: [number, number, string][][] | null;
}

// Silence measured in narrated chapters (inserted pause + Kokoro's own edges), so the
// estimate for chapters without timings drifts less. See backend/ayvu/align.py.
const PARAGRAPH_PAUSE = 0.9;
const LINE_PAUSE = 0.35;
const SENTENCE_END = /(?<=[.!?…;:।。！？])\s+/;

const memory = new Map<string, Promise<ChapterTextRow | null>>();

export async function fetchChapterText(chapterId: string): Promise<ChapterTextRow | null> {
  const { data, error } = await supabase()
    .from("chapter_texts")
    .select("content,timings")
    .eq("chapter_id", chapterId)
    .maybeSingle();
  if (error || !data) return null;
  return data as ChapterTextRow;
}

/** Text of a chapter: the offline copy if there is one, else the server. Cached per session. */
export function loadChapterText(
  chapter: Chapter,
  offline: (chapter: Chapter) => Promise<ChapterTextRow | null>,
): Promise<ChapterTextRow | null> {
  const key = `${chapter.id}:${chapter.size_bytes ?? 0}`; // a regenerated chapter gets new timings
  let pending = memory.get(key);
  if (!pending) {
    pending = offline(chapter)
      .catch(() => null)
      .then((local) => local ?? fetchChapterText(chapter.id))
      .catch(() => null);
    pending.then((row) => !row && memory.delete(key)); // retry later (e.g. back online)
    memory.set(key, pending);
  }
  return pending;
}

/** Real timings from the TTS worker, or an estimate spread over the audio by text length. */
export function buildScript(row: ChapterTextRow, duration: number): Script {
  if (row.timings?.length) {
    return row.timings
      .map((para) => para.filter((s) => s[2]).map(([start, end, text]) => ({ start, end, text })))
      .filter((para) => para.length);
  }
  return estimateScript(row.content, duration);
}

function estimateScript(content: string, duration: number): Script {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((p) => p.split(SENTENCE_END).filter(Boolean));
  if (!paragraphs.length) return [];
  const pieces = paragraphs.reduce((n, p) => n + p.length, 0);
  const pauses = (paragraphs.length - 1) * PARAGRAPH_PAUSE + (pieces - paragraphs.length) * LINE_PAUSE;
  const chars = paragraphs.reduce((n, p) => n + p.reduce((m, s) => m + s.length, 0), 0);
  const speech = Math.max(duration - pauses, duration * 0.5, 1);
  const perChar = speech / Math.max(chars, 1);
  let t = 0;
  return paragraphs.map((para, pi) => {
    if (pi) t += PARAGRAPH_PAUSE;
    return para.map((text, si) => {
      if (si) t += LINE_PAUSE;
      const start = t;
      t += text.length * perChar;
      return { start, end: t, text };
    });
  });
}

/** Where the narration is: paragraph, segment and how many of its characters were spoken. */
export interface Cursor {
  p: number;
  s: number;
  chars: number;
}

export function cursorAt(script: Script, time: number): Cursor {
  let lo = 0;
  let hi = script.length - 1;
  if (hi < 0) return { p: 0, s: 0, chars: 0 };
  // Last paragraph that has started.
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (script[mid][0].start <= time) lo = mid;
    else hi = mid - 1;
  }
  const para = script[lo];
  let s = 0;
  while (s < para.length - 1 && para[s + 1].start <= time) s++;
  const seg = para[s];
  const span = Math.max(seg.end - seg.start, 0.001);
  const fraction = Math.min(1, Math.max(0, (time - seg.start) / span));
  return { p: lo, s, chars: Math.round(seg.text.length * fraction) };
}
