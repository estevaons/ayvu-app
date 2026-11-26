"""Kokoro narration streamed straight into an MP3 encoder, so memory stays flat
no matter how long the chapter is."""

from __future__ import annotations

import logging
import re
import subprocess
import time
from typing import Callable
from pathlib import Path

logger = logging.getLogger("ayvu.tts")

KOKORO_REPO_ID = "hexgrad/Kokoro-82M"
SAMPLE_RATE = 24000
# Speech at 64 kbps mono is transparent for a single voice and ~3x smaller than 192k stereo.
MP3_BITRATE = "64k"
LINE_PAUSE_SECONDS = 0.12
PARAGRAPH_PAUSE_SECONDS = 0.45

# espeak-based languages: Kokoro only chunks on [.!?], so long sentences (or scripts that
# end sentences with other marks) can exceed the 510-phoneme limit and get truncated.
_ESPEAK_LINE_MAX_CHARS = 280
_SENTENCE_END = re.compile(r"(?<=[.!?…;:।。！？])\s+")
_CLAUSE_BREAK = re.compile(r"(?<=[,;:—–])\s+")


def _split_long_piece(piece: str, max_chars: int) -> list[str]:
    if len(piece) <= max_chars:
        return [piece]
    parts: list[str] = []
    for clause in _CLAUSE_BREAK.split(piece):
        while len(clause) > max_chars:
            cut = clause.rfind(" ", 0, max_chars)
            cut = cut if cut > 0 else max_chars
            parts.append(clause[:cut].strip())
            clause = clause[cut:].strip()
        if clause:
            parts.append(clause)
    return parts


def prepare_text_for_espeak(text: str, *, max_chars: int = _ESPEAK_LINE_MAX_CHARS) -> str:
    """Regroup text into newline-separated lines of whole sentences, each <= max_chars."""
    lines: list[str] = []
    for paragraph in re.split(r"\n+", text):
        paragraph = re.sub(r"\s+", " ", paragraph).strip()
        if not paragraph:
            continue
        current = ""
        for sentence in _SENTENCE_END.split(paragraph):
            for piece in _split_long_piece(sentence.strip(), max_chars):
                if not piece:
                    continue
                if current and len(current) + 1 + len(piece) > max_chars:
                    lines.append(current)
                    current = piece
                else:
                    current = f"{current} {piece}".strip()
        if current:
            lines.append(current)
    return "\n".join(lines)


def paragraphs_for_narration(text: str, *, espeak: bool) -> list[str]:
    """Paragraphs, each already split into the lines the Kokoro pipeline should speak."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if espeak:
        return [prepare_text_for_espeak(p) for p in paragraphs if prepare_text_for_espeak(p)]
    return [re.sub(r"[ \t]*\n[ \t]*", " ", p) for p in paragraphs]


class Mp3Writer:
    """Pipe float PCM into ffmpeg and get an MP3 file out."""

    def __init__(self, output_path: Path):
        self.output_path = output_path
        self.samples = 0
        self._proc = subprocess.Popen(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "1", "-i", "pipe:0",
                "-c:a", "libmp3lame", "-b:a", MP3_BITRATE, "-ac", "1",
                str(output_path),
            ],
            stdin=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def write(self, audio) -> None:
        import numpy as np

        if hasattr(audio, "detach"):
            audio = audio.detach().cpu().numpy()
        pcm = (np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0) * 32767).astype("<i2")
        self.samples += len(pcm)
        assert self._proc.stdin is not None
        self._proc.stdin.write(pcm.tobytes())

    def silence(self, seconds: float) -> None:
        import numpy as np

        self.write(np.zeros(int(SAMPLE_RATE * seconds), dtype=np.float32))

    def close(self) -> float:
        assert self._proc.stdin is not None
        self._proc.stdin.close()
        stderr = self._proc.stderr.read().decode(errors="replace") if self._proc.stderr else ""
        if self._proc.wait() != 0:
            raise RuntimeError(f"ffmpeg failed: {stderr[:500]}")
        return self.samples / SAMPLE_RATE

    def abort(self) -> None:
        try:
            self._proc.kill()
        except Exception:
            pass


class NarrationStopped(Exception):
    """The book was cancelled or deleted while its chapter was being narrated."""


class KokoroEngine:
    """One KModel on the GPU, one lightweight KPipeline (G2P) per language."""

    def __init__(self, device: str | None = None):
        import torch
        from kokoro import KModel

        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        started = time.perf_counter()
        self.model = KModel(repo_id=KOKORO_REPO_ID).to(self.device).eval()
        self._pipelines: dict[str, object] = {}
        logger.info("Kokoro ready device=%s in %.1fs", self.device, time.perf_counter() - started)

    def pipeline(self, lang_code: str):
        from kokoro import KPipeline

        if lang_code not in self._pipelines:
            self._pipelines[lang_code] = KPipeline(lang_code=lang_code, repo_id=KOKORO_REPO_ID, model=self.model)
        return self._pipelines[lang_code]

    def narrate_to_mp3(
        self,
        text: str,
        *,
        voice: str,
        output_path: Path,
        speed: float = 0.95,
        should_stop: "Callable[[], bool] | None" = None,
    ) -> float:
        """Synthesize `text` with `voice` into `output_path`. Returns duration in seconds."""
        lang_code = voice[0]
        pipeline = self.pipeline(lang_code)
        paragraphs = paragraphs_for_narration(text, espeak=lang_code not in ("a", "b"))
        if not paragraphs:
            raise ValueError("Chapter has no narratable text.")
        writer = Mp3Writer(output_path)
        started = time.perf_counter()
        try:
            produced = False
            for idx, paragraph in enumerate(paragraphs):
                if should_stop is not None and should_stop():
                    raise NarrationStopped()
                if idx:
                    writer.silence(PARAGRAPH_PAUSE_SECONDS)
                first_line = True
                for result in pipeline(paragraph, voice=voice, speed=speed, split_pattern=r"\n+"):
                    audio = getattr(result, "audio", None)
                    if audio is None and isinstance(result, tuple):
                        audio = result[2]
                    if audio is None:
                        continue
                    if not first_line:
                        writer.silence(LINE_PAUSE_SECONDS)
                    writer.write(audio)
                    first_line = False
                    produced = True
            if not produced:
                raise RuntimeError("Kokoro produced no audio for this chapter.")
            duration = writer.close()
        except BaseException:
            writer.abort()
            raise
        logger.info(
            "Narrated voice=%s paragraphs=%d audio=%.0fs in %.1fs",
            voice, len(paragraphs), duration, time.perf_counter() - started,
        )
        return duration
