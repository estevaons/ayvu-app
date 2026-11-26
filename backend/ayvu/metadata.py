"""Title, author and cover image from the source file. Every step is best effort:
a book without metadata still gets narrated."""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("ayvu.metadata")

COVER_MAX_SIDE = 900


@dataclass
class BookMetadata:
    title: str | None = None
    author: str | None = None
    cover_jpeg: bytes | None = None


def _clean(value: object) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split()).strip()
    return text[:300] or None


def _to_jpeg(image_bytes: bytes) -> bytes | None:
    from PIL import Image

    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            img = img.convert("RGB")
            img.thumbnail((COVER_MAX_SIDE, COVER_MAX_SIDE))
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=85, optimize=True)
            return out.getvalue()
    except Exception:
        logger.warning("Could not decode cover image", exc_info=True)
        return None


def _epub_cover_bytes(book) -> bytes | None:
    from ebooklib import ITEM_COVER, ITEM_IMAGE

    for item in book.get_items_of_type(ITEM_COVER):
        return item.get_content()
    cover_id = None
    for _value, attrs in book.get_metadata("OPF", "cover"):
        cover_id = attrs.get("content")
    if cover_id:
        item = book.get_item_with_id(cover_id)
        if item is not None:
            return item.get_content()
    images = list(book.get_items_of_type(ITEM_IMAGE))
    for item in images:
        name = (item.get_name() or "").lower()
        if "cover" in name or "cover" in (item.get_id() or "").lower():
            return item.get_content()
    return None


def read_epub_metadata(path: str) -> BookMetadata:
    from ebooklib import epub

    book = epub.read_epub(path)
    meta = BookMetadata()
    titles = book.get_metadata("DC", "title")
    creators = book.get_metadata("DC", "creator")
    meta.title = _clean(titles[0][0]) if titles else None
    meta.author = _clean(", ".join(c[0] for c in creators if c and c[0])) if creators else None
    cover = _epub_cover_bytes(book)
    if cover:
        meta.cover_jpeg = _to_jpeg(cover)
    return meta


def read_pdf_metadata(path: str) -> BookMetadata:
    meta = BookMetadata()
    try:
        from pypdf import PdfReader

        info = PdfReader(path).metadata
        if info:
            meta.title = _clean(info.title)
            meta.author = _clean(info.author)
    except Exception:
        logger.warning("Could not read PDF metadata", exc_info=True)
    try:
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(path)
        try:
            page = pdf[0]
            image = page.render(scale=1.6).to_pil()
            buf = io.BytesIO()
            image.save(buf, format="PNG")
            meta.cover_jpeg = _to_jpeg(buf.getvalue())
        finally:
            pdf.close()
    except Exception:
        logger.warning("Could not render PDF cover", exc_info=True)
    # Many PDFs carry junk titles such as "Microsoft Word - draft.docx".
    if meta.title and (meta.title.lower().startswith("microsoft word") or meta.title.lower().endswith((".doc", ".docx", ".pdf"))):
        meta.title = None
    return meta


def read_metadata(path: str) -> BookMetadata:
    ext = Path(path).suffix.lower()
    try:
        if ext == ".epub":
            return read_epub_metadata(path)
        if ext == ".pdf":
            return read_pdf_metadata(path)
    except Exception:
        logger.warning("Metadata extraction failed path=%s", path, exc_info=True)
    return BookMetadata()
