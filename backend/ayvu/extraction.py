import logging
import posixpath
import re
from dataclasses import dataclass
from pathlib import Path


CHAPTER_HEADER_PATTERN = re.compile(r"(?im)^(?:cap[ií]tulo|chapter)\s+[\wivxlcdm\d]+(?:\s*[-–:]\s*.*)?$")
logger = logging.getLogger("ayvu.extraction")


@dataclass
class ChapterPayload:
    title: str | None
    text: str


def sanitize_text_content(text: str) -> str:
    return text.replace("\x00", "")


def normalize_text_whitespace(text: str) -> str:
    text = sanitize_text_content(text)
    text = text.replace("\r", "\n")
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalize_pdf_body_text(text: str, safety_margin: int = 8) -> str:
    text = sanitize_text_content(text)
    text = text.replace("\r", "\n")
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    normalized_lines: list[str] = []
    for line in text.split("\n"):
        cleaned_line = re.sub(r"[ \t]+", " ", line).strip()
        if cleaned_line:
            normalized_lines.append(cleaned_line)
    if not normalized_lines:
        return ""
    body_line_lengths = [len(line) for line in normalized_lines if len(line.split()) >= 4]
    if body_line_lengths:
        mean_line_length = sum(body_line_lengths) / len(body_line_lengths)
    else:
        mean_line_length = sum(len(line) for line in normalized_lines) / len(normalized_lines)
    paragraph_end_threshold = max(20, mean_line_length - safety_margin)
    paragraphs: list[str] = []
    current_lines: list[str] = []
    for line in normalized_lines:
        current_lines.append(line)
        if len(line) <= paragraph_end_threshold:
            paragraphs.append(" ".join(current_lines).strip())
            current_lines = []
    if current_lines:
        paragraphs.append(" ".join(current_lines).strip())
    return "\n\n".join(p for p in paragraphs if p)


def remove_repeated_page_lines(page_lines_list: list[list[str]]) -> list[list[str]]:
    line_frequency: dict[str, int] = {}
    total_pages = len(page_lines_list)
    for lines in page_lines_list:
        unique_lines = {line.casefold() for line in lines if line}
        for line in unique_lines:
            line_frequency[line] = line_frequency.get(line, 0) + 1
    min_repetition = max(3, int(total_pages * 0.25))
    repeated_lines = {
        line for line, count in line_frequency.items() if count >= min_repetition and len(line) <= 80
    }
    cleaned_pages: list[list[str]] = []
    for lines in page_lines_list:
        cleaned_pages.append([line for line in lines if line and line.casefold() not in repeated_lines])
    return cleaned_pages


def _extract_pdf_chapter_title(header_line: str) -> str:
    """Return subtitle after delimiter, or the full header line.

    Delimiters are colon or spaced hyphens/dashes between label and title.
    Internal hyphens in spelled-out numbers (e.g. CHAPTER TWENTY-TWO) are not delimiters.
    """
    cleaned = header_line.strip()
    sep_match = re.search(r":|\s+-\s+|\s+–\s+|\s+—\s+", cleaned)
    if sep_match:
        title_part = cleaned[sep_match.end() :].strip()
        if title_part:
            return title_part
    return cleaned


def split_pdf_text_into_chapters(full_text: str) -> list[tuple[str | None, str]]:
    matches = list(CHAPTER_HEADER_PATTERN.finditer(full_text))
    if not matches:
        return [(None, full_text)]
    chapters: list[tuple[str | None, str]] = []
    for idx, match in enumerate(matches):
        start = match.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(full_text)
        chapter_text = full_text[start:end].strip()
        if len(chapter_text.split()) > 50:
            title = _extract_pdf_chapter_title(match.group(0))
            chapters.append((title, chapter_text))
    return chapters or [(None, full_text)]


def extract_chapters_from_pdf(pdf_path: str) -> list[ChapterPayload]:
    from pypdf import PdfReader

    logger.info("Starting PDF extraction path=%s", pdf_path)
    reader = PdfReader(pdf_path)
    pages_lines: list[list[str]] = []
    for page in reader.pages:
        raw_text = (page.extract_text() or "").replace("\r", "\n")
        pages_lines.append([line.strip() for line in raw_text.split("\n")])
    cleaned_pages = remove_repeated_page_lines(pages_lines)
    full_text = "\n\n".join("\n".join(lines) for lines in cleaned_pages).strip()
    full_text = normalize_text_whitespace(full_text)
    raw_chapters = split_pdf_text_into_chapters(full_text)
    result: list[ChapterPayload] = []
    for title, body in raw_chapters:
        normalized = normalize_pdf_body_text(body)
        if len(normalized.split()) > 30:
            result.append(ChapterPayload(title=title, text=normalized))
    logger.info(
        "Completed PDF extraction path=%s pages=%d raw_chapters=%d extracted_chapters=%d",
        pdf_path,
        len(reader.pages),
        len(raw_chapters),
        len(result),
    )
    return result


def _extract_epub_chapter_title(soup) -> str | None:
    for tag in ("h1", "h2", "h3"):
        heading = soup.find(tag)
        if heading:
            title = heading.get_text(strip=True)
            if title:
                return title
    return None


_TOC_MARKER = "\u2063AYVU-TOC-{}\u2063"
_TOC_MARKER_PATTERN = re.compile("\u2063AYVU-TOC-(\\d+)\u2063")
_MIN_CHAPTER_CHARS = 100
# A chapter label printed just before the TOC anchor ("IV", "12", "Capítulo 3") belongs to the next chapter.
_TRAILING_CHAPTER_LABEL = re.compile(
    r"\n\s*((?:(?:cap[ií]tulo|chapter|parte|part|livro|book)\s+)?(?:[ivxlcdm]+|\d+)\.?)\s*$",
    re.IGNORECASE,
)


@dataclass
class _TocEntry:
    document: str
    fragment: str
    title: str | None


def _split_href(href: str) -> tuple[str, str]:
    from urllib.parse import unquote

    path, _, fragment = href.partition("#")
    return posixpath.normpath(unquote(path)) if path else "", unquote(fragment)


def _split_html_at_toc_anchors(
    html: str | bytes, entries: list[_TocEntry], *, separator: str = ""
) -> tuple[str, list[tuple[str | None, str]]]:
    """Cut one HTML document at the elements the TOC points to.

    Returns the text before the first anchor (usually the tail of the previous chapter)
    and one (title, text) pair per anchor found, in document order.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    for idx, entry in enumerate(entries):
        target = soup.find(id=entry.fragment) or soup.find(attrs={"name": entry.fragment})
        if target is not None:
            target.insert_before(f"\n{_TOC_MARKER.format(idx)}\n")
    parts = _TOC_MARKER_PATTERN.split(soup.get_text(separator))
    preamble = parts[0]
    sections = [(entries[int(parts[i])].title, parts[i + 1]) for i in range(1, len(parts), 2)]
    return preamble, sections


def _assemble_toc_chapters(raw: list[tuple[str | None, str]]) -> list[ChapterPayload]:
    """Normalize sections and fold ones too short to narrate on their own (bare headings) forward."""
    raw = list(raw)
    for idx in range(len(raw) - 1):
        match = _TRAILING_CHAPTER_LABEL.search(raw[idx][1])
        if match:
            raw[idx] = (raw[idx][0], raw[idx][1][: match.start()])
            raw[idx + 1] = (raw[idx + 1][0], f"{match.group(1)}\n{raw[idx + 1][1]}")
    chapters: list[ChapterPayload] = []
    carry_title: str | None = None
    carry_text = ""
    for title, text in raw:
        text = normalize_text_whitespace(f"{carry_text}\n\n{text}" if carry_text else text)
        title = carry_title or title
        if len(text) < _MIN_CHAPTER_CHARS:
            carry_title, carry_text = title, text
            continue
        carry_title, carry_text = None, ""
        chapters.append(ChapterPayload(title=title, text=text))
    if carry_text and chapters:
        last = chapters[-1]
        chapters[-1] = ChapterPayload(title=last.title, text=f"{last.text}\n\n{carry_text}")
    return chapters


def _chapters_from_toc_documents(
    documents: list[tuple[str, str | bytes]], toc: list[_TocEntry], *, separator: str = ""
) -> list[ChapterPayload] | None:
    """Split documents (in reading order) into chapters at the TOC's anchors.

    Returns None when the TOC does not point inside documents (one chapter per file is then right).
    """
    by_document: dict[str, list[_TocEntry]] = {}
    for entry in toc:
        if entry.fragment:
            by_document.setdefault(entry.document, []).append(entry)
    if not any(len(entries) > 1 for entries in by_document.values()):
        return None
    raw: list[tuple[str | None, str]] = []
    for name, html in documents:
        entries = by_document.get(name)
        if not entries:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(html, "html.parser")
            whole_file_title = next((e.title for e in toc if e.document == name and not e.fragment), None)
            raw.append((whole_file_title or _extract_epub_chapter_title(soup), soup.get_text(separator)))
            continue
        preamble, sections = _split_html_at_toc_anchors(html, entries, separator=separator)
        if raw:
            raw[-1] = (raw[-1][0], f"{raw[-1][1]}\n{preamble}")
        else:
            raw.append((None, preamble))
        raw.extend(sections)
    chapters = _assemble_toc_chapters(raw)
    return chapters or None


def _flatten_epub_toc(toc) -> list[_TocEntry]:
    entries: list[_TocEntry] = []
    for node in toc:
        if isinstance(node, (tuple, list)):
            if isinstance(node, tuple) and len(node) == 2 and isinstance(node[1], (list, tuple)):
                section, children = node
                href = getattr(section, "href", None)
                if href:
                    entries.append(_TocEntry(*_split_href(href), getattr(section, "title", None)))
                entries.extend(_flatten_epub_toc(children))
            else:
                entries.extend(_flatten_epub_toc(node))
            continue
        href = getattr(node, "href", None) or getattr(node, "file_name", None)
        if href:
            entries.append(_TocEntry(*_split_href(href), getattr(node, "title", None)))
    return entries


def _extract_epub_chapters_by_toc(book) -> list[ChapterPayload] | None:
    from ebooklib import ITEM_DOCUMENT

    toc = _flatten_epub_toc(book.toc)
    if not toc:
        return None
    documents: list[tuple[str, bytes]] = []
    for idref, *_rest in book.spine:
        item = book.get_item_with_id(idref)
        if item is not None and item.get_type() == ITEM_DOCUMENT:
            documents.append((posixpath.normpath(item.get_name()), item.get_body_content()))
    return _chapters_from_toc_documents(documents, toc)


def extract_chapters_from_epub(epub_path: str) -> list[ChapterPayload]:
    from bs4 import BeautifulSoup
    from ebooklib import ITEM_DOCUMENT, epub

    logger.info("Starting EPUB extraction path=%s", epub_path)
    book = epub.read_epub(epub_path)
    # Many EPUBs (and every Kindle KF8 file) pack several chapters per file; the TOC knows where they start.
    toc_chapters = _extract_epub_chapters_by_toc(book)
    if toc_chapters:
        logger.info("Completed EPUB extraction by TOC path=%s extracted_chapters=%d", epub_path, len(toc_chapters))
        return toc_chapters
    chapters: list[ChapterPayload] = []
    document_items = 0
    for item in book.get_items():
        if item.get_type() == ITEM_DOCUMENT:
            document_items += 1
            soup = BeautifulSoup(item.get_body_content(), "html.parser")
            text = normalize_text_whitespace(soup.get_text())
            if len(text.strip()) > 100:
                title = _extract_epub_chapter_title(soup)
                chapters.append(ChapterPayload(title=title, text=text))
    logger.info(
        "Completed EPUB extraction path=%s document_items=%d extracted_chapters=%d",
        epub_path,
        document_items,
        len(chapters),
    )
    return chapters


MOBI_EXTENSIONS = {".mobi", ".azw", ".azw3"}
SUPPORTED_EBOOK_EXTENSIONS = {".pdf", ".epub", ".txt", *MOBI_EXTENSIONS}
_MOBI_PAGEBREAK_PATTERN = re.compile(r"<mbp:pagebreak\s*/?>", re.IGNORECASE)


def _read_ncx_toc(ncx: bytes) -> list[_TocEntry]:
    import warnings

    from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

    with warnings.catch_warnings():
        # html.parser handles the simple NCX fine and avoids depending on lxml.
        warnings.simplefilter("ignore", XMLParsedAsHTMLWarning)
        soup = BeautifulSoup(ncx, "html.parser")
    entries: list[_TocEntry] = []
    for nav_point in soup.find_all("navpoint"):
        content = nav_point.find("content")
        label = nav_point.find("navlabel")
        if content is None or not content.get("src"):
            continue
        title = label.get_text(" ", strip=True) if label else None
        entries.append(_TocEntry(*_split_href(content["src"]), title or None))
    return entries


def extract_chapters_from_mobi7_html(html_path: str) -> list[ChapterPayload]:
    """Old-style MOBI (mobi7) unpacks to one book.html; chapters are separated by <mbp:pagebreak/>."""
    from bs4 import BeautifulSoup, UnicodeDammit

    # mobi7 HTML keeps the book's original codec (often cp1252); let bs4 sniff it.
    raw_html = UnicodeDammit(Path(html_path).read_bytes(), ["utf-8", "cp1252"]).unicode_markup or ""
    ncx_path = Path(html_path).with_name("toc.ncx")
    if ncx_path.exists():
        toc = _read_ncx_toc(ncx_path.read_bytes())
        html_name = Path(html_path).name
        toc_chapters = _chapters_from_toc_documents([(html_name, raw_html)], toc, separator="\n")
        if toc_chapters:
            return toc_chapters
    parts = _MOBI_PAGEBREAK_PATTERN.split(raw_html)
    chapters: list[ChapterPayload] = []
    for part in parts:
        soup = BeautifulSoup(part, "html.parser")
        text = normalize_text_whitespace(soup.get_text("\n"))
        if len(text.strip()) > 100:
            chapters.append(ChapterPayload(title=_extract_epub_chapter_title(soup), text=text))
    if len(chapters) <= 1:
        # No usable page breaks: fall back to "Chapter N" / "Capítulo N" headings like PDFs.
        full_text = normalize_text_whitespace(BeautifulSoup(raw_html, "html.parser").get_text("\n"))
        chapters = [
            ChapterPayload(title=title, text=body)
            for title, body in split_pdf_text_into_chapters(full_text)
            if len(body.split()) > 30
        ]
    return chapters


def extract_chapters_from_mobi(mobi_path: str) -> list[ChapterPayload]:
    """Kindle MOBI/AZW/AZW3 (DRM-free): unpack with KindleUnpack, then reuse the EPUB/HTML/PDF readers."""
    import shutil

    import mobi

    logger.info("Starting MOBI extraction path=%s", mobi_path)
    tempdir = None
    try:
        try:
            tempdir, unpacked_path = mobi.extract(mobi_path)
        except Exception as exc:
            raise ValueError(
                "Could not read this Kindle file. DRM-protected books are not supported."
            ) from exc
        unpacked_ext = Path(unpacked_path).suffix.lower()
        logger.info("Unpacked MOBI path=%s unpacked=%s", mobi_path, unpacked_path)
        if unpacked_ext == ".epub":
            chapters = extract_chapters_from_epub(unpacked_path)
        elif unpacked_ext == ".pdf":
            chapters = extract_chapters_from_pdf(unpacked_path)
        else:
            chapters = extract_chapters_from_mobi7_html(unpacked_path)
    finally:
        if tempdir:
            shutil.rmtree(tempdir, ignore_errors=True)
    logger.info("Completed MOBI extraction path=%s extracted_chapters=%d", mobi_path, len(chapters))
    return chapters


def extract_chapters_from_ebook(ebook_path: str) -> list[ChapterPayload]:
    ext = Path(ebook_path).suffix.lower()
    logger.info("Dispatching ebook extraction path=%s ext=%s", ebook_path, ext or "<none>")
    if ext == ".pdf":
        return extract_chapters_from_pdf(ebook_path)
    if ext == ".epub":
        return extract_chapters_from_epub(ebook_path)
    if ext in MOBI_EXTENSIONS:
        return extract_chapters_from_mobi(ebook_path)
    if ext == ".txt":
        return extract_chapters_from_txt(ebook_path)
    raise ValueError(f"Unsupported file format: {ext}")


def extract_chapters_from_txt(txt_path: str) -> list[ChapterPayload]:
    from bs4 import UnicodeDammit

    raw = UnicodeDammit(Path(txt_path).read_bytes(), ["utf-8", "cp1252", "latin-1"]).unicode_markup or ""
    full_text = normalize_text_whitespace(raw)
    return [
        ChapterPayload(title=title, text=body)
        for title, body in split_pdf_text_into_chapters(full_text)
        if len(body.split()) > 30
    ]
