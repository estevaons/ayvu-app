"""End-to-end smoke test against the deployed app (storage -> prepare -> GPU TTS -> audio).

    uv run modal run scripts/smoke.py --user-id <uuid> --epub path/to/book.epub

Uses the deployed functions and the `ayvu-supabase` secret; the user must already exist.
"""

import time
import uuid
from pathlib import Path

import modal

app = modal.App("ayvu-smoke")
image = modal.Image.debian_slim(python_version="3.12").pip_install("supabase>=2.15")


@app.function(image=image, secrets=[modal.Secret.from_name("ayvu-supabase")], timeout=1800)
def smoke(user_id: str, epub: bytes) -> dict:
    import os

    from supabase import create_client

    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    book_id = str(uuid.uuid4())
    path = f"{user_id}/{book_id}/source.epub"
    db.storage.from_("uploads").upload(path, epub, {"content-type": "application/epub+zip"})
    db.table("books").insert({
        "id": book_id, "user_id": user_id, "title": "smoke", "source_path": path,
        "source_filename": "smoke.epub", "source_format": "epub", "status": "uploaded",
    }).execute()

    started = time.time()
    modal.Function.from_name("ayvu", "prepare").remote(book_id, use_metadata_title=True)
    book = db.table("books").select("*").eq("id", book_id).single().execute().data
    print("after prepare:", {k: book[k] for k in ("status", "title", "author", "language_code", "voice", "total_chapters", "cover_path", "error_code")})
    if book["status"] != "queued":
        return {"book": book}

    while time.time() - started < 1500:
        book = db.table("books").select("*").eq("id", book_id).single().execute().data
        print(f"[{time.time() - started:5.0f}s] {book['status']} {book['completed_chapters']}/{book['total_chapters']}")
        if book["status"] in ("completed", "failed"):
            break
        time.sleep(10)
    chapters = db.table("chapters").select("chapter_index,title,status,duration_seconds,size_bytes,last_error,audio_path").eq("book_id", book_id).order("chapter_index").execute().data
    return {"book": book, "chapters": chapters, "seconds": round(time.time() - started)}


@app.local_entrypoint()
def main(user_id: str, epub: str):
    result = smoke.remote(user_id, Path(epub).read_bytes())
    book = result["book"]
    print("RESULT", book["status"], book.get("error_code"), book.get("error_message"))
    for c in result.get("chapters", []):
        print("  ", c)
    print("book_id", book["id"], "elapsed", result.get("seconds"))
