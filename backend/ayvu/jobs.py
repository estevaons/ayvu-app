"""Book preparation and chapter generation against Supabase (service role)."""

from __future__ import annotations

import logging
import os
import tempfile
import time
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

from ayvu.extraction import (
    SUPPORTED_EBOOK_EXTENSIONS,
    extract_chapters_from_ebook,
    sanitize_text_content,
    split_long_chapters,
)
from ayvu.language import (
    BookLanguageError,
    detect_supported_book_language,
    get_language_profile,
    resolve_voice,
    supported_language_names,
)
from ayvu.tts import NarrationStopped

logger = logging.getLogger("ayvu.jobs")

MAX_ATTEMPTS = 3
ACTIVE_STATUSES = ("uploaded", "preparing", "queued", "generating")


@lru_cache
def supabase():
    from supabase import create_client

    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


def utcnow_iso(delta: timedelta = timedelta(0)) -> str:
    return (datetime.now(timezone.utc) + delta).isoformat()


def audio_path(user_id: str, book_id: str, chapter_index: int) -> str:
    return f"{user_id}/{book_id}/{chapter_index:04d}.mp3"


def get_book(book_id: str) -> dict | None:
    rows = supabase().table("books").select("*").eq("id", book_id).limit(1).execute().data
    return rows[0] if rows else None


def update_book(book_id: str, **fields) -> None:
    supabase().table("books").update(fields).eq("id", book_id).execute()


def remove_prefix(bucket: str, prefix: str) -> None:
    store = supabase().storage.from_(bucket)
    while True:
        entries = store.list(prefix, {"limit": 1000}) or []
        paths = [f"{prefix}/{e['name']}" for e in entries if e.get("name")]
        if not paths:
            return
        store.remove(paths)
        if len(paths) < 1000:
            return


# ---------------------------------------------------------------------------
# prepare_book
# ---------------------------------------------------------------------------
class PrepareError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def prepare_book(book_id: str, *, use_metadata_title: bool = False) -> bool:
    """Extract chapters, detect language, pick voice and enqueue chapters.

    Returns True when chapters were queued (the caller should wake the TTS workers).
    """
    from ayvu.metadata import read_metadata

    book = get_book(book_id)
    if book is None or book["status"] == "cancelled":
        logger.info("Skip prepare book=%s (missing or cancelled)", book_id)
        return False
    update_book(book_id, status="preparing", error_code=None, error_message=None)

    try:
        ext = Path(book["source_path"]).suffix.lower()
        if ext not in SUPPORTED_EBOOK_EXTENSIONS:
            raise PrepareError("unsupported_format", f"Unsupported file format: {ext}")
        data = supabase().storage.from_("uploads").download(book["source_path"])
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / f"source{ext}"
            src.write_bytes(data)
            try:
                chapters = extract_chapters_from_ebook(str(src))
            except ValueError as exc:
                raise PrepareError("unreadable_file", str(exc)) from exc
            meta = read_metadata(str(src))

        chapters = [c for c in chapters if sanitize_text_content(c.text).strip()]
        chapters = split_long_chapters(chapters)
        if not chapters:
            raise PrepareError("no_text", "No readable text was found in this file. Scanned PDFs are not supported yet.")

        if book.get("language_override"):
            profile = get_language_profile(book["language_override"])
            if profile is None:
                raise PrepareError("unsupported_language", f"Supported languages: {supported_language_names()}.")
        else:
            try:
                profile = detect_supported_book_language("\n\n".join(c.text for c in chapters))
            except BookLanguageError as exc:
                update_book(book_id, language_code=exc.detected_language)
                raise PrepareError(exc.code, str(exc)) from exc
        voice = resolve_voice(profile.code, book.get("voice"))

        # Re-preparing (retry): start from a clean slate.
        db = supabase()
        db.table("chapters").delete().eq("book_id", book_id).execute()
        remove_prefix("audio", f"{book['user_id']}/{book_id}")

        cover_path = None
        if meta.cover_jpeg:
            cover_path = f"{book['user_id']}/{book_id}/cover.jpg"
            db.storage.from_("covers").upload(
                cover_path, meta.cover_jpeg, {"content-type": "image/jpeg", "upsert": "true"}
            )

        rows = []
        texts = []
        for idx, chapter in enumerate(chapters, start=1):
            text = sanitize_text_content(chapter.text).strip()
            title = sanitize_text_content(chapter.title).strip()[:300] if chapter.title else None
            rows.append({
                "book_id": book_id,
                "user_id": book["user_id"],
                "chapter_index": idx,
                "title": title or None,
                "word_count": len(text.split()),
                "status": "pending",
            })
            texts.append(text)

        inserted: list[dict] = []
        for start in range(0, len(rows), 200):
            inserted += db.table("chapters").insert(rows[start : start + 200]).execute().data
        by_index = {row["chapter_index"]: row["id"] for row in inserted}
        batch: list[dict] = []
        batch_chars = 0
        for idx, text in enumerate(texts, start=1):
            batch.append({"chapter_id": by_index[idx], "content": text})
            batch_chars += len(text)
            if batch_chars > 2_000_000:
                db.table("chapter_texts").insert(batch).execute()
                batch, batch_chars = [], 0
        if batch:
            db.table("chapter_texts").insert(batch).execute()

        fields = {
            "status": "queued",
            "language_code": profile.code,
            "voice": voice,
            "total_chapters": len(rows),
            "completed_chapters": 0,
            "failed_chapters": 0,
            "total_duration_seconds": 0,
            "cover_path": cover_path,
            "error_code": None,
            "error_message": None,
        }
        if meta.author:
            fields["author"] = meta.author
        if use_metadata_title and meta.title:
            fields["title"] = meta.title
        # The user may have cancelled while we were extracting.
        latest = get_book(book_id)
        if latest is None:
            return False
        if latest["status"] == "cancelled":
            fields["status"] = "cancelled"
            db.table("chapters").update({"status": "cancelled"}).eq("book_id", book_id).execute()
        update_book(book_id, **fields)
        logger.info("Prepared book=%s chapters=%d language=%s voice=%s", book_id, len(rows), profile.code, voice)
        return fields["status"] == "queued"
    except PrepareError as exc:
        logger.warning("Prepare failed book=%s code=%s: %s", book_id, exc.code, exc)
        update_book(book_id, status="failed", error_code=exc.code, error_message=str(exc)[:1000])
        return False
    except Exception as exc:
        logger.exception("Prepare crashed book=%s", book_id)
        update_book(book_id, status="failed", error_code="preparation_failed", error_message=str(exc)[:1000])
        return False


# ---------------------------------------------------------------------------
# generate_chapter
# ---------------------------------------------------------------------------
def claim_next_chapter() -> dict | None:
    rows = supabase().rpc("claim_next_chapter").execute().data
    return rows[0] if rows else None


def _retry_delay(attempt: int) -> timedelta:
    return timedelta(seconds=30) if attempt <= 1 else timedelta(minutes=2)


def fail_chapter(chapter: dict, message: str, *, retryable: bool = True) -> None:
    attempt = int(chapter.get("attempt_count") or 1)
    final = not retryable or attempt >= MAX_ATTEMPTS
    supabase().table("chapters").update({
        "status": "failed" if final else "pending",
        "last_error": message[:1000],
        "locked_at": None,
        "available_at": utcnow_iso(_retry_delay(attempt)),
    }).eq("id", chapter["id"]).execute()
    logger.warning("Chapter %s failed attempt=%d final=%s: %s", chapter["id"], attempt, final, message[:200])


def generate_chapter(engine, chapter: dict) -> None:
    db = supabase()
    book = get_book(chapter["book_id"])
    if book is None:
        return  # deleted mid-flight; the row cascade already removed the chapter
    if book["status"] == "cancelled":
        db.table("chapters").update({"status": "cancelled", "locked_at": None}).eq("id", chapter["id"]).execute()
        return
    try:
        text_rows = db.table("chapter_texts").select("content").eq("chapter_id", chapter["id"]).execute().data
        if not text_rows:
            raise ValueError("Chapter text is missing.")
        voice = book.get("voice") or resolve_voice(book.get("language_code") or "en", None)
        checked = [time.monotonic()]

        def should_stop() -> bool:
            # Livro apagado ou cancelado no meio: libera a GPU em vez de narrar até o fim.
            if time.monotonic() - checked[0] < 20:
                return False
            checked[0] = time.monotonic()
            current = get_book(book["id"])
            return current is None or current["status"] == "cancelled"

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "chapter.mp3"
            timings: list[list[list]] = []
            duration = engine.narrate_to_mp3(
                text_rows[0]["content"], voice=voice, output_path=out, should_stop=should_stop, timings=timings
            )
            size = out.stat().st_size
            path = audio_path(book["user_id"], book["id"], chapter["chapter_index"])
            db.storage.from_("audio").upload(
                path, out.read_bytes(),
                {"content-type": "audio/mpeg", "cache-control": "31536000", "upsert": "true"},
            )
        # Marcas de tempo por trecho falado: o app mostra o texto aparecendo junto com o áudio.
        # Falhar aqui não pode perder o áudio já gerado: sem as marcas, o app estima o tempo.
        try:
            db.table("chapter_texts").update({"timings": timings}).eq("chapter_id", chapter["id"]).execute()
        except Exception:
            logger.warning("Could not save timings chapter=%s", chapter["id"], exc_info=True)
        db.table("chapters").update({
            "status": "completed",
            "audio_path": path,
            "duration_seconds": round(duration, 2),
            "size_bytes": size,
            "locked_at": None,
            "last_error": None,
        }).eq("id", chapter["id"]).execute()
        logger.info("Chapter done book=%s idx=%d duration=%.0fs", book["id"], chapter["chapter_index"], duration)
    except NarrationStopped:
        logger.info("Chapter stopped: book cancelled or deleted book=%s", book["id"])
        db.table("chapters").update({"status": "cancelled", "locked_at": None}).eq("id", chapter["id"]).execute()
    except BookLanguageError as exc:
        fail_chapter(chapter, str(exc), retryable=False)
    except ValueError as exc:
        fail_chapter(chapter, str(exc), retryable=False)
    except Exception as exc:
        logger.exception("Chapter crashed id=%s", chapter["id"])
        fail_chapter(chapter, f"{type(exc).__name__}: {exc}")


def queue_stats() -> tuple[int, int]:
    rows = supabase().rpc("queue_stats").execute().data
    if not rows:
        return 0, 0
    return int(rows[0]["pending"] or 0), int(rows[0]["generating"] or 0)


def reset_stale_chapters(minutes: int = 20) -> int:
    return int(supabase().rpc("reset_stale_chapters", {"p_stale_minutes": minutes}).execute().data or 0)


def backfill_timings(limit: int = 1000) -> dict:
    """Timings for chapters narrated before the worker recorded them, found in their audio.

    A chapter that can't be aligned gets `[]`, so it isn't tried again (the app estimates)."""
    from ayvu.align import decode_mp3, find_silences, timings_from_silences

    db = supabase()
    done = failed = 0
    while done + failed < limit:
        rows = (
            db.table("chapter_texts")
            .select("chapter_id,content,chapters!inner(status,audio_path,duration_seconds,books!inner(voice))")
            .is_("timings", "null")
            .eq("chapters.status", "completed")
            .limit(min(10, limit - done - failed))
            .execute()
            .data
        )
        if not rows:
            break
        for row in rows:
            chapter = row["chapters"]
            timings: list = []
            try:
                voice = (chapter.get("books") or {}).get("voice") or "a"
                with tempfile.TemporaryDirectory() as tmp:
                    path = Path(tmp) / "chapter.mp3"
                    path.write_bytes(db.storage.from_("audio").download(chapter["audio_path"]))
                    pcm = decode_mp3(path)
                duration = float(chapter.get("duration_seconds") or 0) or len(pcm) / 8000
                timings = timings_from_silences(
                    row["content"], espeak=voice[0] not in ("a", "b"), duration=duration, silences=find_silences(pcm)
                )
                done += 1
            except Exception:
                logger.exception("Could not align chapter=%s", row["chapter_id"])
                failed += 1
            db.table("chapter_texts").update({"timings": timings}).eq("chapter_id", row["chapter_id"]).execute()
            logger.info("Timings chapter=%s paragraphs=%d", row["chapter_id"], len(timings))
    return {"aligned": done, "failed": failed}
