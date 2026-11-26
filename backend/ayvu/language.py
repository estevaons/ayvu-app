"""Book language detection and the mapping from detected language to a Kokoro voice.

Detection samples a handful of windows spread across the extracted text and takes a
majority vote, so front matter (copyright pages, English blurbs in translated books)
does not decide the language on its own.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import dataclass

logger = logging.getLogger("ayvu.language")


@dataclass(frozen=True)
class LanguageProfile:
    code: str
    name: str
    kokoro_lang_code: str
    default_voice: str


# Every language Kokoro-82M can speak without extra G2P packages. English uses misaki's G2P
# (Kokoro lang "a"/"b"); the rest go through espeak-ng.
SUPPORTED_LANGUAGES: dict[str, LanguageProfile] = {
    "en": LanguageProfile("en", "English", "a", "af_heart"),
    "pt": LanguageProfile("pt", "Português (Brasil)", "p", "pf_dora"),
    "es": LanguageProfile("es", "Español", "e", "ef_dora"),
    "fr": LanguageProfile("fr", "Français", "f", "ff_siwis"),
    "it": LanguageProfile("it", "Italiano", "i", "if_sara"),
    "hi": LanguageProfile("hi", "हिन्दी", "h", "hf_alpha"),
}

# Voices offered in the app, by language. A Kokoro voice id starts with its pipeline
# lang code ("bf_emma" -> "b", British English), so the voice also picks the G2P.
VOICES: dict[str, tuple[str, ...]] = {
    "en": ("af_heart", "af_bella", "af_nicole", "am_michael", "am_fenrir", "bf_emma", "bm_george", "bm_fable"),
    "pt": ("pf_dora", "pm_alex", "pm_santa"),
    "es": ("ef_dora", "em_alex"),
    "fr": ("ff_siwis",),
    "it": ("if_sara", "im_nicola"),
    "hi": ("hf_alpha", "hf_beta", "hm_omega", "hm_psi"),
}


def resolve_voice(language_code: str, requested: str | None) -> str:
    """The requested voice when it speaks this language, else the language default."""
    profile = get_language_profile(language_code)
    if profile is None:
        raise UnsupportedLanguageError(
            f"Unsupported language '{language_code}'.", detected_language=normalize_language_code(language_code)
        )
    if requested and requested in VOICES.get(profile.code, ()):
        return requested
    return profile.default_voice


DEFAULT_SAMPLE_COUNT = 10
DEFAULT_SAMPLE_CHARS = 600
_MIN_SAMPLE_LETTERS = 40


class BookLanguageError(RuntimeError):
    """Base class for language problems that retrying the job cannot fix."""

    code = "language_error"

    def __init__(self, message: str, *, detected_language: str | None = None) -> None:
        super().__init__(message)
        self.detected_language = detected_language


class LanguageDetectionError(BookLanguageError):
    code = "language_undetected"


class UnsupportedLanguageError(BookLanguageError):
    code = "unsupported_language"


@dataclass(frozen=True)
class LanguageDetection:
    code: str
    votes: int
    samples: int


def normalize_language_code(code: str | None) -> str:
    """Map codes such as "pt-BR", "en_US" or "zh-cn" to their base ISO 639-1 code."""
    if not code:
        return ""
    return re.split(r"[-_]", code.strip().lower(), maxsplit=1)[0]


def get_language_profile(code: str | None) -> LanguageProfile | None:
    return SUPPORTED_LANGUAGES.get(normalize_language_code(code))


def supported_language_names() -> str:
    return ", ".join(f"{p.name} ({p.code})" for p in SUPPORTED_LANGUAGES.values())


def _sample_windows(text: str, *, count: int, sample_chars: int) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    if len(text) <= sample_chars * count:
        # Short text: split it into up to `count` contiguous windows.
        step = max(sample_chars, len(text) // count or 1)
        starts = range(0, len(text), step)
    else:
        # Spread windows evenly, skipping the first/last few percent (covers, indexes).
        margin = int(len(text) * 0.03)
        usable = len(text) - 2 * margin - sample_chars
        starts = [margin + (usable * i) // max(count - 1, 1) for i in range(count)]
    samples: list[str] = []
    for start in starts:
        # Align to word boundaries so the detector does not see cut-off words.
        if start > 0:
            space = text.find(" ", start)
            start = space + 1 if space != -1 else start
        end = start + sample_chars
        if end < len(text):
            space = text.rfind(" ", start, end)
            end = space if space > start else end
        window = text[start:end].strip()
        if sum(ch.isalpha() for ch in window) >= _MIN_SAMPLE_LETTERS:
            samples.append(window)
    return samples[:count]


def detect_text_language(
    text: str,
    *,
    sample_count: int = DEFAULT_SAMPLE_COUNT,
    sample_chars: int = DEFAULT_SAMPLE_CHARS,
) -> LanguageDetection:
    from langdetect import DetectorFactory, LangDetectException, detect

    DetectorFactory.seed = 0  # langdetect is randomized; keep results reproducible.
    samples = _sample_windows(text, count=sample_count, sample_chars=sample_chars)
    votes: Counter[str] = Counter()
    for sample in samples:
        try:
            votes[normalize_language_code(detect(sample))] += 1
        except LangDetectException:
            continue
    if not votes:
        raise LanguageDetectionError("Could not detect the book language: not enough readable text.")
    code, count = votes.most_common(1)[0]
    logger.info("Detected language=%s votes=%s samples=%d", code, dict(votes), len(samples))
    return LanguageDetection(code=code, votes=count, samples=len(samples))


def detect_supported_book_language(text: str) -> LanguageProfile:
    detection = detect_text_language(text)
    profile = get_language_profile(detection.code)
    if profile is None:
        raise UnsupportedLanguageError(
            f"Unsupported book language '{detection.code}'. Supported languages: {supported_language_names()}.",
            detected_language=detection.code,
        )
    return profile
