"use client";

import {
  ChevronDown,
  Gauge,
  ListMusic,
  Loader2,
  Moon,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { clock } from "@/lib/format";
import { RATES, usePlayer, type SleepTimer } from "@/lib/player";
import { usePrefs } from "@/lib/prefs";
import { Cover } from "./Cover";
import { Sheet } from "./ui";

function useChapterLabel() {
  const { t } = usePrefs();
  return (c: { title: string | null; chapter_index: number } | null) =>
    c ? c.title || t("book.chapter", { index: c.chapter_index }) : "";
}

export function MiniPlayer() {
  const p = usePlayer();
  const { t } = usePrefs();
  const label = useChapterLabel();
  if (!p.book) return null;
  const fill = p.duration ? p.position / p.duration : 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-3">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-elevated/95 shadow-soft backdrop-blur-xl">
        <div className="absolute inset-x-0 top-0 h-0.5 bg-line">
          <div className="h-full bg-accent" style={{ width: `${fill * 100}%` }} />
        </div>
        <div className="flex items-center gap-3 p-2 pr-1.5">
          <button
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            onClick={() => p.setExpanded(true)}
            aria-label={t("player.nowPlaying")}
          >
            <Cover title={p.book.title} coverPath={p.book.cover_path} size="sm" className="w-10 shrink-0 rounded-md" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{p.book.title}</span>
              <span className="block truncate text-xs text-muted">
                {p.waitingNext ? t("book.generatingNow") : label(p.chapter)}
              </span>
            </span>
          </button>
          <button className="icon-btn" onClick={() => p.seekBy(-15)} aria-label={t("player.back15")}>
            <RotateCcw className="size-5" />
          </button>
          <button
            className="icon-btn size-11 bg-ink text-bg hover:bg-ink"
            onClick={p.toggle}
            aria-label={p.playing ? t("player.pause") : t("player.play")}
            disabled={p.waitingNext}
          >
            {p.loading || p.waitingNext ? (
              <Loader2 className="size-5 animate-spin" />
            ) : p.playing ? (
              <Pause className="size-5 fill-current" />
            ) : (
              <Play className="ml-0.5 size-5 fill-current" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

const SLEEP_OPTIONS = [15, 30, 45, 60];

function sleepLabel(sleep: SleepTimer, t: ReturnType<typeof usePrefs>["t"], now: number) {
  if (sleep.mode === "chapter") return t("player.sleepEnd");
  if (sleep.mode === "time") return clock(Math.max(0, (sleep.endsAt - now) / 1000));
  return t("player.sleep");
}

export function PlayerSheet() {
  const p = usePlayer();
  const { t } = usePrefs();
  const label = useChapterLabel();
  const [panel, setPanel] = useState<null | "speed" | "sleep" | "chapters">(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (p.sleep.mode !== "time") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [p.sleep]);

  // Android back button / browser back closes the full player first.
  useEffect(() => {
    if (!p.expanded) return;
    let remove: (() => void) | undefined;
    void import("@capacitor/app").then(({ App }) =>
      App.addListener("backButton", () => p.setExpanded(false)).then((h) => (remove = () => void h.remove())),
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") p.setExpanded(false);
      if (e.key === " " && (e.target as HTMLElement)?.tagName !== "INPUT") {
        e.preventDefault();
        p.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      remove?.();
      window.removeEventListener("keydown", onKey);
    };
  }, [p.expanded, p]);

  if (!p.book || !p.expanded) return null;
  const position = scrub ?? p.position;
  const duration = p.duration || p.chapter?.duration_seconds || 0;
  const fill = duration ? (position / duration) * 100 : 0;
  const idx = p.chapters.findIndex((c) => c.chapter_index === p.chapter?.chapter_index);

  return (
    <div className="fixed inset-0 z-[60] flex animate-sheet-up flex-col bg-bg pt-safe pb-safe">
      {/* Ambient tint from the cover */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-60">
        <div className="absolute -top-1/3 left-1/2 size-[140%] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]" />
      </div>

      <header className="relative flex items-center justify-between px-3 py-2">
        <button className="icon-btn" onClick={() => p.setExpanded(false)} aria-label={t("player.minimize")}>
          <ChevronDown className="size-6" />
        </button>
        <span className="eyebrow">{t("player.nowPlaying")}</span>
        <button className="icon-btn" onClick={p.close} aria-label={t("common.close")}>
          <X className="size-5" />
        </button>
      </header>

      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-7 px-7">
        <Cover
          title={p.book.title}
          author={p.book.author}
          coverPath={p.book.cover_path}
          size="lg"
          className="mx-auto w-[min(68vw,300px)] rounded-2xl"
        />

        <div className="text-center">
          <h2 className="line-clamp-2 font-serif text-2xl leading-tight">{label(p.chapter)}</h2>
          <p className="mt-1 truncate text-sm text-muted">
            {p.book.title}
            {p.book.author ? ` · ${p.book.author}` : ""}
          </p>
        </div>

        {p.waitingNext ? (
          <div className="flex items-center gap-3 rounded-2xl bg-accent-soft p-4 text-sm text-ink">
            <Loader2 className="size-5 shrink-0 animate-spin text-accent" />
            {t("player.waitingNext")}
          </div>
        ) : p.error ? (
          <p className="rounded-2xl bg-danger-soft p-4 text-center text-sm text-danger">{t("player.loadError")}</p>
        ) : (
          <div>
            <input
              type="range"
              className="scrubber"
              min={0}
              max={duration || 1}
              step={1}
              value={Math.min(position, duration || 1)}
              style={{ "--fill": `${fill}%` } as React.CSSProperties}
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={() => {
                if (scrub != null) p.seekTo(scrub);
                setScrub(null);
              }}
              onKeyUp={() => {
                if (scrub != null) p.seekTo(scrub);
                setScrub(null);
              }}
              aria-label="Seek"
            />
            <div className="mt-1 flex justify-between text-xs tabular-nums text-muted">
              <span>{clock(position)}</span>
              <span>-{clock(Math.max(0, duration - position) / p.rate)}</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <button className="icon-btn size-12" onClick={p.prev} aria-label={t("player.prev")} disabled={idx <= 0 && p.position < 5}>
            <SkipBack className="size-6 fill-current" />
          </button>
          <button className="icon-btn relative size-14" onClick={() => p.seekBy(-15)} aria-label={t("player.back15")}>
            <RotateCcw className="size-8" strokeWidth={1.6} />
            <span className="absolute text-[10px] font-bold">15</span>
          </button>
          <button
            className="grid size-20 place-items-center rounded-full bg-accent text-accent-ink shadow-soft transition active:scale-95 disabled:opacity-60"
            onClick={p.toggle}
            disabled={p.waitingNext}
            aria-label={p.playing ? t("player.pause") : t("player.play")}
          >
            {p.loading ? (
              <Loader2 className="size-8 animate-spin" />
            ) : p.playing ? (
              <Pause className="size-8 fill-current" />
            ) : (
              <Play className="ml-1 size-8 fill-current" />
            )}
          </button>
          <button className="icon-btn relative size-14" onClick={() => p.seekBy(30)} aria-label={t("player.forward30")}>
            <RotateCw className="size-8" strokeWidth={1.6} />
            <span className="absolute text-[10px] font-bold">30</span>
          </button>
          <button
            className="icon-btn size-12"
            onClick={p.next}
            aria-label={t("player.next")}
            disabled={idx === -1 || idx >= p.chapters.length - 1}
          >
            <SkipForward className="size-6 fill-current" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button className="btn-ghost h-12 flex-col gap-0.5 text-xs font-medium" onClick={() => setPanel("speed")}>
            <Gauge className="size-4.5" />
            {p.rate}×
          </button>
          <button
            className={`btn-ghost h-12 flex-col gap-0.5 text-xs font-medium ${p.sleep.mode !== "off" ? "text-accent" : ""}`}
            onClick={() => setPanel("sleep")}
          >
            <Moon className="size-4.5" />
            <span className="tabular-nums">{sleepLabel(p.sleep, t, now)}</span>
          </button>
          <button className="btn-ghost h-12 flex-col gap-0.5 text-xs font-medium" onClick={() => setPanel("chapters")}>
            <ListMusic className="size-4.5" />
            {idx >= 0 ? `${idx + 1}/${p.chapters.length}` : t("player.chapters")}
          </button>
        </div>
      </div>

      <Sheet open={panel === "speed"} onClose={() => setPanel(null)} title={t("player.speed")}>
        <div className="grid grid-cols-3 gap-2">
          {RATES.map((r) => (
            <button
              key={r}
              className={`btn h-12 ${r === p.rate ? "bg-accent text-accent-ink" : "bg-elevated"}`}
              onClick={() => {
                p.setRate(r);
                setPanel(null);
              }}
            >
              {r}×
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={panel === "sleep"} onClose={() => setPanel(null)} title={t("player.sleep")}>
        <div className="flex flex-col gap-1">
          {[
            { key: "off", label: t("player.sleepOff"), mode: "off" as const, minutes: 0 },
            ...SLEEP_OPTIONS.map((m) => ({ key: `t${m}`, label: t("player.sleepIn", { minutes: m }), mode: "time" as const, minutes: m })),
            { key: "chapter", label: t("player.sleepEnd"), mode: "chapter" as const, minutes: 0 },
          ].map((opt) => {
            const active =
              opt.mode === p.sleep.mode && (opt.mode !== "time" || (p.sleep.mode === "time" && p.sleep.minutes === opt.minutes));
            return (
              <button
                key={opt.key}
                className={`flex h-12 items-center justify-between rounded-2xl px-4 text-left text-[15px] ${active ? "bg-accent-soft text-accent" : "hover:bg-elevated"}`}
                onClick={() => {
                  p.setSleep(
                    opt.mode === "time"
                      ? { mode: "time", minutes: opt.minutes, endsAt: Date.now() + opt.minutes * 60_000 }
                      : { mode: opt.mode },
                  );
                  setPanel(null);
                }}
              >
                {opt.label}
                {active && <span className="size-2 rounded-full bg-accent" />}
              </button>
            );
          })}
        </div>
      </Sheet>

      <Sheet open={panel === "chapters"} onClose={() => setPanel(null)} title={t("player.chapters")}>
        <ol className="flex flex-col">
          {p.chapters.map((c) => {
            const current = c.chapter_index === p.chapter?.chapter_index;
            const ready = c.status === "completed";
            return (
              <li key={c.id}>
                <button
                  disabled={!ready}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left disabled:opacity-45 ${current ? "bg-accent-soft" : "hover:bg-elevated"}`}
                  onClick={() => {
                    void p.playBook(c.book_id, { chapterIndex: c.chapter_index });
                    setPanel(null);
                  }}
                >
                  <span className={`w-6 text-right text-sm tabular-nums ${current ? "text-accent" : "text-faint"}`}>
                    {c.chapter_index}
                  </span>
                  <span className={`min-w-0 flex-1 truncate text-[15px] ${current ? "font-semibold text-accent" : ""}`}>
                    {label(c)}
                  </span>
                  <span className="text-xs tabular-nums text-muted">
                    {ready && c.duration_seconds ? clock(c.duration_seconds) : c.status === "generating" ? <Loader2 className="size-4 animate-spin" /> : "—"}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </Sheet>
    </div>
  );
}
