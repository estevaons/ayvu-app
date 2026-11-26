"""Ayvu on Modal.

    modal deploy app.py

- `api`        FastAPI web endpoint the app calls for every write (create/retry/cancel/delete).
- `prepare`    CPU job: extract chapters, metadata, cover, language; enqueue chapters.
- `TTSWorker`  GPU job: drains the fair queue (round-robin across users) chapter by chapter.
- `dispatch`   Wakes enough TTS workers for the queue; also runs on a schedule to recover
               stuck chapters and pick up retries whose back-off has elapsed.
"""

import os
import re
import time

import modal

APP_NAME = "ayvu"
# "L4"/"T4"/... or "cpu". GPUs need a payment method on the Modal account.
GPU = os.environ.get("AYVU_GPU", "L4")
TTS_RESOURCES = {"cpu": 8.0, "memory": 8192} if GPU.lower() == "cpu" else {"gpu": GPU}
MAX_TTS_WORKERS = int(os.environ.get("AYVU_MAX_TTS_WORKERS", "4"))
ACTIVE_BOOK_LIMIT = {"free": 3, "pro": 20}

app = modal.App(APP_NAME)
secrets = [modal.Secret.from_name("ayvu-supabase")]

base_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "supabase>=2.15",
        "fastapi[standard]>=0.115",
        "pypdf>=5.0",
        "pypdfium2>=4.30",
        "pillow>=11.0",
        "ebooklib>=0.18",
        "beautifulsoup4>=4.12",
        "langdetect>=1.0.9",
        "mobi>=0.3.3",
    )
)
web_image = base_image.add_local_python_source("ayvu")

tts_image = (
    base_image.apt_install("ffmpeg", "espeak-ng")
    .pip_install(
        "kokoro>=0.9.4",
        "misaki[en]>=0.9.4",
        "soundfile",
        "numpy",
        "https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl",
    )
    .run_commands(
        # Bake model weights and every voice into the image: no download on cold start.
        "python -c \"from huggingface_hub import snapshot_download; snapshot_download('hexgrad/Kokoro-82M')\""
    )
    .add_local_python_source("ayvu")
)


# ---------------------------------------------------------------------------
# Background jobs
# ---------------------------------------------------------------------------
@app.function(image=web_image, secrets=secrets, timeout=900, memory=2048, retries=0)
def prepare(book_id: str, use_metadata_title: bool = False) -> None:
    from ayvu.jobs import prepare_book

    if prepare_book(book_id, use_metadata_title=use_metadata_title):
        dispatch.local()


@app.cls(
    image=tts_image,
    **TTS_RESOURCES,
    secrets=secrets,
    timeout=3600,
    scaledown_window=90,
    max_containers=MAX_TTS_WORKERS,
)
class TTSWorker:
    @modal.enter()
    def load(self) -> None:
        import logging

        from ayvu.tts import KokoroEngine

        logging.basicConfig(level=logging.INFO)
        self.engine = KokoroEngine()

    @modal.method()
    def drain(self) -> int:
        """Generate chapters until the queue is empty (or this call nears its timeout)."""
        from ayvu.jobs import claim_next_chapter, generate_chapter

        deadline = time.monotonic() + 50 * 60
        done = 0
        idle_polls = 0
        while time.monotonic() < deadline:
            chapter = claim_next_chapter()
            if chapter is None:
                idle_polls += 1
                if idle_polls > 3:
                    break
                time.sleep(5)
                continue
            idle_polls = 0
            generate_chapter(self.engine, chapter)
            done += 1
        return done


@app.function(image=web_image, secrets=secrets, timeout=120, schedule=modal.Period(minutes=3))
def dispatch() -> dict:
    from ayvu.jobs import queue_stats, reset_stale_chapters

    recovered = reset_stale_chapters(20)
    pending, generating = queue_stats()
    wanted = max(0, min(pending, MAX_TTS_WORKERS - generating))
    for _ in range(wanted):
        TTSWorker().drain.spawn()
    return {"recovered": recovered, "pending": pending, "generating": generating, "spawned": wanted}


# ---------------------------------------------------------------------------
# Web API
# ---------------------------------------------------------------------------
@app.function(image=web_image, secrets=secrets, min_containers=0, scaledown_window=300)
@modal.concurrent(max_inputs=50)
@modal.asgi_app()
def api():
    from fastapi import Depends, FastAPI, Header, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel, Field

    from ayvu.extraction import SUPPORTED_EBOOK_EXTENSIONS
    from ayvu.jobs import ACTIVE_STATUSES, get_book, remove_prefix, supabase, utcnow_iso
    from ayvu.language import SUPPORTED_LANGUAGES, VOICES

    web = FastAPI(title="Ayvu API")
    extra_origins = [o.strip() for o in os.environ.get("AYVU_WEB_ORIGINS", "").split(",") if o.strip()]
    web.add_middleware(
        CORSMiddleware,
        allow_origins=["capacitor://localhost", "https://localhost", "http://localhost", *extra_origins],
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def error(status: int, code: str, message: str) -> HTTPException:
        return HTTPException(status_code=status, detail={"code": code, "message": message})

    def current_user(authorization: str = Header(default="")) -> str:
        token = authorization.removeprefix("Bearer ").strip()
        if not token:
            raise error(401, "unauthorized", "Missing access token.")
        try:
            user = supabase().auth.get_user(token).user
        except Exception:
            user = None
        if user is None:
            raise error(401, "unauthorized", "Invalid or expired session.")
        return str(user.id)

    def owned_book(book_id: str, user_id: str) -> dict:
        book = get_book(book_id)
        if book is None or book["user_id"] != user_id:
            raise error(404, "book_not_found", "Book not found.")
        return book

    class CreateBook(BaseModel):
        source_path: str
        filename: str = Field(max_length=300)
        title: str | None = Field(default=None, max_length=300)
        language: str | None = None
        voice: str | None = None

    class UpdateBook(BaseModel):
        title: str = Field(min_length=1, max_length=300)

    path_re = re.compile(r"^(?P<user>[0-9a-f-]{36})/(?P<book>[0-9a-f-]{36})/source(?P<ext>\.[a-z0-9]+)$")

    @web.get("/health")
    def health():
        return {"ok": True}

    @web.get("/voices")
    def voices():
        return {
            code: {"name": profile.name, "default": profile.default_voice, "voices": list(VOICES.get(code, ()))}
            for code, profile in SUPPORTED_LANGUAGES.items()
        }

    @web.post("/books", status_code=201)
    def create_book(body: CreateBook, user_id: str = Depends(current_user)):
        match = path_re.match(body.source_path)
        if not match or match["user"] != user_id:
            raise error(400, "invalid_path", "Upload path does not belong to this account.")
        ext = match["ext"]
        if ext not in SUPPORTED_EBOOK_EXTENSIONS:
            raise error(400, "unsupported_format", "Supported formats: PDF, EPUB, MOBI, AZW, AZW3, TXT.")
        if body.language and body.language not in SUPPORTED_LANGUAGES:
            raise error(400, "unsupported_language", "Unsupported language.")

        db = supabase()
        profile = db.table("profiles").select("plan").eq("id", user_id).limit(1).execute().data
        plan = profile[0]["plan"] if profile else "free"
        active = (
            db.table("books").select("id", count="exact").eq("user_id", user_id)
            .in_("status", list(ACTIVE_STATUSES)).execute().count or 0
        )
        if active >= ACTIVE_BOOK_LIMIT.get(plan, 3):
            raise error(429, "too_many_active_books", "Wait for your current books to finish before adding more.")

        folder = f"{user_id}/{match['book']}"
        if not any(e.get("name") == f"source{ext}" for e in (db.storage.from_("uploads").list(folder) or [])):
            raise error(400, "upload_missing", "Upload the file before creating the book.")

        fallback_title = re.sub(r"[_\-]+", " ", body.filename.rsplit(".", 1)[0]).strip() or "Untitled"
        title = (body.title or "").strip()
        row = db.table("books").insert({
            "id": match["book"],
            "user_id": user_id,
            "title": title or fallback_title,
            "source_path": body.source_path,
            "source_filename": body.filename,
            "source_format": ext.lstrip("."),
            "language_override": body.language,
            "voice": body.voice,
            "status": "uploaded",
        }).execute().data[0]
        prepare.spawn(row["id"], use_metadata_title=not title)
        return row

    @web.patch("/books/{book_id}")
    def rename_book(book_id: str, body: UpdateBook, user_id: str = Depends(current_user)):
        owned_book(book_id, user_id)
        return supabase().table("books").update({"title": body.title.strip()}).eq("id", book_id).execute().data[0]

    @web.post("/books/{book_id}/retry")
    def retry_book(book_id: str, user_id: str = Depends(current_user)):
        book = owned_book(book_id, user_id)
        db = supabase()
        if book["total_chapters"] == 0:
            if book["status"] in ("preparing", "uploaded"):
                raise error(409, "busy", "This book is already being prepared.")
            db.table("books").update({"status": "uploaded", "error_code": None, "error_message": None}).eq("id", book_id).execute()
            prepare.spawn(book_id, use_metadata_title=False)
            return {"ok": True, "action": "prepare"}
        if book["status"] == "cancelled":
            db.table("books").update({"status": "queued"}).eq("id", book_id).execute()
        db.table("chapters").update({
            "status": "pending", "attempt_count": 0, "last_error": None, "locked_at": None,
            "available_at": utcnow_iso(),
        }).eq("book_id", book_id).in_("status", ["failed", "cancelled"]).execute()
        dispatch.spawn()
        return {"ok": True, "action": "generate"}

    @web.post("/books/{book_id}/cancel")
    def cancel_book(book_id: str, user_id: str = Depends(current_user)):
        book = owned_book(book_id, user_id)
        if book["status"] not in ACTIVE_STATUSES:
            raise error(409, "not_active", "This book is not being generated.")
        db = supabase()
        db.table("books").update({"status": "cancelled"}).eq("id", book_id).execute()
        db.table("chapters").update({"status": "cancelled"}).eq("book_id", book_id).eq("status", "pending").execute()
        return {"ok": True}

    @web.delete("/books/{book_id}", status_code=204)
    def delete_book(book_id: str, user_id: str = Depends(current_user)):
        owned_book(book_id, user_id)
        prefix = f"{user_id}/{book_id}"
        for bucket in ("uploads", "audio", "covers"):
            try:
                remove_prefix(bucket, prefix)
            except Exception:
                pass
        supabase().table("books").delete().eq("id", book_id).execute()

    return web
