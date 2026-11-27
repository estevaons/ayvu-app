"""Timings for chapters narrated before the TTS worker recorded them.

The narration has a predictable shape: a ~0.45 s pause (plus Kokoro's own edge silence,
~0.9 s in total) between paragraphs and a shorter one between the lines Kokoro speaks.
We find the silences in the MP3 and pick, with dynamic programming, the ones that best
split the audio into paragraphs (then lines) whose lengths match the text. On real
chapters every paragraph lands on its pause, so the app can follow along closely.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from .tts import paragraphs_for_narration

DECODE_RATE = 8000  # plenty to find silences, and 3x less memory than the 24 kHz original
_FRAME = 0.02
_SILENCE_RMS = 0.004
_SENTENCE_END = re.compile(r"(?<=[.!?…;:।。！？])\s+")

Silence = tuple[float, float]  # (start, length) in seconds


def decode_mp3(path: Path):
    """Mono float PCM at DECODE_RATE."""
    import numpy as np

    raw = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
         "-f", "s16le", "-ac", "1", "-ar", str(DECODE_RATE), "pipe:1"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def find_silences(pcm, sample_rate: int = DECODE_RATE, *, min_len: float = 0.25) -> list[Silence]:
    import numpy as np

    win = max(1, int(sample_rate * _FRAME))
    frames = len(pcm) // win
    if not frames:
        return []
    rms = np.sqrt(np.mean(np.square(pcm[: frames * win].reshape(frames, win)), axis=1))
    quiet = np.concatenate(([False], rms < _SILENCE_RMS, [False]))
    edges = np.flatnonzero(np.diff(quiet.astype(np.int8)))
    out: list[Silence] = []
    for start, end in zip(edges[::2], edges[1::2]):
        length = (end - start) * _FRAME
        if length >= min_len:
            out.append((round(start * _FRAME, 3), round(length, 3)))
    return out


def _proportional(weights: list[int], t0: float, t1: float) -> list[tuple[float, float]]:
    total = sum(weights) or 1
    spans, t = [], t0
    for w in weights:
        end = t + (t1 - t0) * w / total
        spans.append((t, end))
        t = end
    return spans


def align_spans(
    weights: list[int],
    t0: float,
    t1: float,
    silences: list[Silence],
    *,
    gap: float = 0.9,
    overhead: float = 0.25,
    long_silence: float = 0.8,
    skip_penalty: float = 3.0,
    short_penalty: float = 2.0,
    iterations: int = 3,
) -> list[tuple[float, float]]:
    """Split [t0, t1] into len(weights) spans, each ending where a silence starts.

    A span's expected length is `rate * weight + overhead`; `rate` is refit after each pass.
    Silences shorter than `long_silence` cost `short_penalty` to use, and long ones left
    inside a span cost `skip_penalty` (set both to 0 when any pause may be a boundary)."""
    n = len(weights)
    if n <= 1:
        return [(t0, t1)]
    cands = [(s, length) for s, length in silences if s > t0 and s + length < t1]
    m = len(cands)
    if m < n - 1:
        return _proportional(weights, t0, t1)
    total = sum(weights) or 1
    rate = max(1e-3, (t1 - t0 - (n - 1) * gap - n * overhead) / total)
    long_before = [0]
    for _, length in cands:
        long_before.append(long_before[-1] + (length >= long_silence))
    use_cost = [short_penalty if length < long_silence else 0.0 for _, length in cands]
    inf = float("inf")
    spans = _proportional(weights, t0, t1)

    for _ in range(iterations):

        def cost(i: int, a: float, b: float) -> float:
            pred = rate * weights[i] + overhead
            return ((b - a - pred) / (0.12 * pred + 0.6)) ** 2

        f = [[inf] * m for _ in range(n - 1)]
        back = [[-1] * m for _ in range(n - 1)]
        for j in range(m):
            f[0][j] = cost(0, t0, cands[j][0]) + use_cost[j] + skip_penalty * long_before[j]
        for i in range(1, n - 1):
            limit = 2.5 * (rate * weights[i] + overhead) + 10
            prev, row, brow = f[i - 1], f[i], back[i]
            for j in range(i, m):
                end = cands[j][0]
                best, arg = inf, -1
                for k in range(j - 1, i - 2, -1):
                    start = cands[k][0] + cands[k][1]
                    if end - start > limit:
                        break
                    if prev[k] == inf:
                        continue
                    v = prev[k] + cost(i, start, end) + skip_penalty * (long_before[j] - long_before[k + 1])
                    if v < best:
                        best, arg = v, k
                if arg >= 0:
                    row[j] = best + use_cost[j]
                    brow[j] = arg
        best, arg = inf, -1
        for j in range(n - 2, m):
            if f[n - 2][j] == inf:
                continue
            v = f[n - 2][j] + cost(n - 1, cands[j][0] + cands[j][1], t1) + skip_penalty * (long_before[m] - long_before[j + 1])
            if v < best:
                best, arg = v, j
        if arg < 0:
            return spans
        picks = [0] * (n - 1)
        j = arg
        for i in range(n - 2, -1, -1):
            picks[i] = j
            j = back[i][j]
        spans, start = [], t0
        for j in picks:
            spans.append((start, cands[j][0]))
            start = cands[j][0] + cands[j][1]
        spans.append((start, t1))
        num = sum((b - a - overhead) * w for (a, b), w in zip(spans, weights))
        den = sum(w * w for w in weights) or 1
        rate = max(1e-3, num / den)
    return spans


def timings_from_silences(text: str, *, espeak: bool, duration: float, silences: list[Silence]) -> list[list[list]]:
    """Same shape the TTS worker records: per paragraph, [start, end, text] segments."""
    paragraphs = paragraphs_for_narration(text, espeak=espeak)
    if not paragraphs or duration <= 0:
        return []
    lines = [[ln.strip() for ln in p.split("\n") if ln.strip()] for p in paragraphs]
    para_spans = align_spans(
        [sum(len(ln) for ln in pl) for pl in lines], 0.0, duration, [s for s in silences if s[1] >= 0.5]
    )
    timings: list[list[list]] = []
    for pl, (a, b) in zip(lines, para_spans):
        if not espeak:
            # Kokoro chunks English internally; show sentences, timed by length.
            pl = [s for s in _SENTENCE_END.split(" ".join(pl)) if s]
            spans = _proportional([len(s) for s in pl], a, b)
        else:
            # Any pause may be a line break here, so no penalties: only the lengths decide.
            spans = align_spans(
                [len(ln) for ln in pl], a, b, silences,
                gap=0.35, overhead=0.1, skip_penalty=0.0, short_penalty=0.0,
            )
        timings.append([[round(s, 3), round(e, 3), ln] for ln, (s, e) in zip(pl, spans)])
    return timings
