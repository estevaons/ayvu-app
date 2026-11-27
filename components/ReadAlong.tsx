"use client";

import { ArrowDown, Loader2 } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildScript, cursorAt, loadChapterText, type ChapterTextRow, type Cursor, type Script, type Segment } from "@/lib/chapterText";
import { offlineChapterText } from "@/lib/offline";
import { usePlayer } from "@/lib/player";
import { usePrefs } from "@/lib/prefs";
import type { Chapter } from "@/lib/types";

/** Script of the playing chapter: `undefined` while loading, `null` when there is no text. */
export function useChapterScript(chapter: Chapter | null, duration: number): Script | null | undefined {
  const [loaded, setLoaded] = useState<{ id: string; row: ChapterTextRow | null } | null>(null);

  useEffect(() => {
    if (!chapter || chapter.status !== "completed") return;
    let alive = true;
    void loadChapterText(chapter, offlineChapterText).then((row) => alive && setLoaded({ id: chapter.id, row }));
    return () => {
      alive = false;
    };
  }, [chapter]);

  return useMemo(() => {
    if (!chapter || loaded?.id !== chapter.id) return undefined;
    if (!loaded.row) return null;
    // Estimated timing needs the real duration; real timings don't.
    if (!loaded.row.timings?.length && !duration) return undefined;
    const script = buildScript(loaded.row, duration);
    return script.length ? script : null;
  }, [chapter, loaded, duration]);
}

const GLOW = 8; // the last characters read light up gradually instead of all at once

/**
 * The whole chapter text, dim, lighting up as it is narrated. Tap a passage to listen from there.
 * Mount it with `key={chapter.id}` so a new chapter starts at the top, following along.
 */
export function ReadAlong({ script }: { script: Script | undefined }) {
  const p = usePlayer();
  const { t } = usePrefs();
  const scroller = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const lastTarget = useRef<number | null>(null);
  const [cursor, setCursor] = useState<Cursor>({ p: 0, s: 0, chars: 0 });
  const [follow, setFollow] = useState(true);
  const { currentTime, seekTo } = p;

  // Per-frame position from the audio element; re-render only when a character appears.
  useEffect(() => {
    if (!script?.length) return;
    let frame = 0;
    const tick = () => {
      const next = cursorAt(script, currentTime());
      setCursor((prev) => (prev.p === next.p && prev.s === next.s && prev.chars === next.chars ? prev : next));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [script, currentTime]);

  // Keep the line being read a little below the middle of the view.
  useLayoutEffect(() => {
    const el = scroller.current;
    const here = mark.current;
    if (!follow || !el || !here) return;
    const offset = here.getBoundingClientRect().top - el.getBoundingClientRect().top;
    const target = Math.max(0, Math.round(el.scrollTop + offset - el.clientHeight * 0.55));
    if (lastTarget.current !== null && Math.abs(target - lastTarget.current) < 4) return;
    const jump = lastTarget.current === null || Math.abs(target - el.scrollTop) > el.clientHeight;
    lastTarget.current = target;
    el.scrollTo({ top: target, behavior: jump ? "auto" : "smooth" });
  }, [cursor, follow]);

  const stopFollowing = useCallback(() => setFollow(false), []);
  const onSeek = useCallback(
    (seg: Segment) => {
      seekTo(seg.start);
      lastTarget.current = null;
      setFollow(true);
    },
    [seekTo],
  );

  if (!script?.length) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center">
        <Loader2 className="size-6 animate-spin text-muted" />
      </div>
    );
  }

  const label = t("player.seekHere");
  const para = script[cursor.p];
  const seg = para[cursor.s];
  const read = seg.text.slice(0, cursor.chars);
  const lit = read.slice(0, Math.max(0, read.length - GLOW));
  const glow = read.slice(lit.length);
  const unread = seg.text.slice(cursor.chars);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onWheel={stopFollowing}
        onTouchMove={stopFollowing}
        className="read-along h-full overflow-y-auto overscroll-contain px-1"
      >
        <div className="flex flex-col gap-4 pt-6 font-serif text-[19px] leading-[1.7] sm:text-xl">
          {script.map((segments, pi) =>
            pi === cursor.p ? (
              <p key={pi}>
                {segments.map((s, si) =>
                  si === cursor.s ? (
                    <span key={si} className="read-along-passage" title={label} onClick={() => onSeek(s)}>
                      <span className="read-along-lit">{lit}</span>
                      {Array.from(glow).map((ch, i, all) => (
                        <span key={i} className="read-along-lit" style={{ opacity: 0.4 + (0.6 * (all.length - i)) / all.length }}>
                          {ch}
                        </span>
                      ))}
                      <span ref={mark} aria-hidden />
                      <span className="read-along-dim">{unread}</span>{" "}
                    </span>
                  ) : (
                    <Passage key={si} segment={s} lit={si < cursor.s} onSeek={onSeek} label={label} />
                  ),
                )}
              </p>
            ) : (
              <Paragraph key={pi} segments={segments} lit={pi < cursor.p} onSeek={onSeek} label={label} />
            ),
          )}
        </div>
        <div className="h-[40%] min-h-24" aria-hidden />
      </div>

      {!follow && (
        <button
          className="btn absolute bottom-3 left-1/2 h-9 -translate-x-1/2 animate-fade gap-1.5 whitespace-nowrap bg-elevated px-3.5 text-xs font-medium shadow-soft"
          onClick={() => {
            lastTarget.current = null;
            setFollow(true);
          }}
        >
          <ArrowDown className="size-3.5" />
          {t("player.follow")}
        </button>
      )}
    </div>
  );
}

type PassageProps = { segment: Segment; lit: boolean; onSeek: (s: Segment) => void; label: string };

const Passage = memo(function Passage({ segment, lit, onSeek, label }: PassageProps) {
  return (
    <span
      className={`read-along-passage ${lit ? "read-along-lit" : "read-along-dim"}`}
      title={label}
      onClick={() => onSeek(segment)}
    >
      {segment.text}{" "}
    </span>
  );
});

// Paragraphs away from the narration only re-render when they flip between read and unread.
const Paragraph = memo(function Paragraph({
  segments,
  lit,
  onSeek,
  label,
}: Omit<PassageProps, "segment"> & { segments: Segment[] }) {
  return (
    <p>
      {segments.map((s, i) => (
        <Passage key={i} segment={s} lit={lit} onSeek={onSeek} label={label} />
      ))}
    </p>
  );
});
