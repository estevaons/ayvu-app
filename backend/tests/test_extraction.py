"""Tests for chapter title extraction and text processing utilities."""

from ayvu.extraction import (
    _extract_epub_chapter_title,
    _extract_pdf_chapter_title,
    normalize_pdf_body_text,
    sanitize_text_content,
    normalize_text_whitespace,
    remove_repeated_page_lines,
    split_pdf_text_into_chapters,
)


# --- PDF chapter title extraction ---


def test_pdf_title_with_separator_dash():
    title = _extract_pdf_chapter_title("Chapter 1 - The Beginning")
    assert title == "The Beginning"


def test_pdf_title_with_separator_colon():
    title = _extract_pdf_chapter_title("Chapter 2: Into the Forest")
    assert title == "Into the Forest"


def test_pdf_title_with_en_dash():
    title = _extract_pdf_chapter_title("Cap\u00edtulo 3 \u2013 O Despertar")
    assert title == "O Despertar"


def test_pdf_title_without_separator():
    title = _extract_pdf_chapter_title("Chapter 4")
    assert title == "Chapter 4"


def test_pdf_title_with_roman_numeral():
    title = _extract_pdf_chapter_title("Chapter IV - The Reckoning")
    assert title == "The Reckoning"


def test_pdf_title_capitulo_portuguese():
    title = _extract_pdf_chapter_title("Cap\u00edtulo 1 - A Jornada")
    assert title == "A Jornada"


def test_pdf_title_spelled_number_hyphen_not_subtitle():
    """Hyphen in TWENTY-TWO must not split; only spaced separators are delimiters."""
    title = _extract_pdf_chapter_title("CHAPTER TWENTY-TWO")
    assert title == "CHAPTER TWENTY-TWO"
    title2 = _extract_pdf_chapter_title("Chapter twenty-one")
    assert title2 == "Chapter twenty-one"


# --- PDF text splitting with titles ---


def test_split_pdf_text_extracts_titles():
    text = (
        "Chapter 1 - Introduction\n"
        + " ".join(["word"] * 60)
        + "\n\nChapter 2: The Middle\n"
        + " ".join(["word"] * 60)
    )
    chapters = split_pdf_text_into_chapters(text)
    assert len(chapters) == 2
    assert chapters[0][0] == "Introduction"
    assert chapters[1][0] == "The Middle"


def test_split_pdf_text_no_chapters_returns_none_title():
    text = " ".join(["word"] * 100)
    chapters = split_pdf_text_into_chapters(text)
    assert len(chapters) == 1
    assert chapters[0][0] is None


def test_split_pdf_text_portuguese_chapters():
    text = (
        "Cap\u00edtulo 1 - O In\u00edcio\n"
        + " ".join(["palavra"] * 60)
        + "\n\nCap\u00edtulo 2 - O Meio\n"
        + " ".join(["palavra"] * 60)
    )
    chapters = split_pdf_text_into_chapters(text)
    assert len(chapters) == 2
    assert chapters[0][0] == "O In\u00edcio"
    assert chapters[1][0] == "O Meio"


def test_split_pdf_skips_short_chapters():
    text = (
        "Chapter 1 - Short\nOnly a few words here.\n\n"
        "Chapter 2 - Long\n" + " ".join(["word"] * 60)
    )
    chapters = split_pdf_text_into_chapters(text)
    # Short chapter (<50 words) should be excluded
    assert len(chapters) == 1
    assert chapters[0][0] == "Long"


# --- EPUB chapter title extraction ---


def test_epub_title_from_h1():
    from bs4 import BeautifulSoup

    soup = BeautifulSoup("<h1>My Chapter Title</h1><p>Some text.</p>", "html.parser")
    title = _extract_epub_chapter_title(soup)
    assert title == "My Chapter Title"


def test_epub_title_from_h2_when_no_h1():
    from bs4 import BeautifulSoup

    soup = BeautifulSoup("<h2>Subtitle Chapter</h2><p>Some text.</p>", "html.parser")
    title = _extract_epub_chapter_title(soup)
    assert title == "Subtitle Chapter"


def test_epub_title_from_h3_when_no_h1_h2():
    from bs4 import BeautifulSoup

    soup = BeautifulSoup("<h3>Deep Heading</h3><p>Some text.</p>", "html.parser")
    title = _extract_epub_chapter_title(soup)
    assert title == "Deep Heading"


def test_epub_title_none_when_no_headings():
    from bs4 import BeautifulSoup

    soup = BeautifulSoup("<p>Just a paragraph.</p>", "html.parser")
    title = _extract_epub_chapter_title(soup)
    assert title is None


def test_epub_title_skips_empty_heading():
    from bs4 import BeautifulSoup

    soup = BeautifulSoup("<h1>  </h1><h2>Real Title</h2><p>Text.</p>", "html.parser")
    title = _extract_epub_chapter_title(soup)
    assert title == "Real Title"


# --- Text normalization ---


def test_normalize_text_whitespace_collapses_spaces():
    result = normalize_text_whitespace("  hello   world  ")
    assert result == "hello world"


def test_normalize_text_whitespace_joins_hyphenated():
    result = normalize_text_whitespace("contin-\nuation")
    assert result == "continuation"


def test_normalize_text_whitespace_collapses_newlines():
    result = normalize_text_whitespace("line1\n\n\n\n\nline2")
    assert result == "line1\n\nline2"


def test_sanitize_text_content_removes_nul_bytes():
    result = sanitize_text_content("before\x00middle\x00after")
    assert result == "beforemiddleafter"


def test_normalize_pdf_body_text_empty():
    result = normalize_pdf_body_text("")
    assert result == ""


def test_normalize_pdf_body_text_joins_lines():
    text = "This is a long sentence that wraps\nacross multiple lines but should\nbe joined into paragraphs."
    result = normalize_pdf_body_text(text)
    assert "\n\n" not in result or "joined" in result


# --- Repeated page lines removal ---


def test_remove_repeated_page_lines():
    pages = [
        ["Header", "Content page 1", "Footer"],
        ["Header", "Content page 2", "Footer"],
        ["Header", "Content page 3", "Footer"],
        ["Header", "Content page 4", "Footer"],
    ]
    cleaned = remove_repeated_page_lines(pages)
    for page in cleaned:
        assert "Header" not in page
        assert "Footer" not in page
    assert any("Content page 1" in line for page in cleaned for line in page)


def test_remove_repeated_page_lines_keeps_unique():
    pages = [
        ["Unique Line A"],
        ["Unique Line B"],
        ["Unique Line C"],
    ]
    cleaned = remove_repeated_page_lines(pages)
    assert cleaned[0] == ["Unique Line A"]
    assert cleaned[1] == ["Unique Line B"]
    assert cleaned[2] == ["Unique Line C"]



# --- MOBI / Kindle extraction ---


def _write_mobi7_html(path, body: str, encoding: str = "utf-8"):
    html = f'<html><head><meta charset="{encoding}"></head><body>{body}</body></html>'
    path.write_bytes(html.encode(encoding))


def test_mobi7_html_is_split_on_pagebreaks(tmp_path):
    from ayvu.extraction import extract_chapters_from_mobi7_html

    paragraph = "<p>" + "Era uma vez uma história contada em português. " * 6 + "</p>"
    body = (
        "<p>Sumário</p><mbp:pagebreak/>"
        f"<h2>Capítulo Um</h2>{paragraph}<mbp:pagebreak />"
        f"<h2>Capítulo Dois</h2>{paragraph}"
    )
    html_path = tmp_path / "book.html"
    _write_mobi7_html(html_path, body, encoding="cp1252")

    chapters = extract_chapters_from_mobi7_html(str(html_path))
    assert [c.title for c in chapters] == ["Capítulo Um", "Capítulo Dois"]
    assert "história contada em português" in chapters[0].text


def test_mobi7_html_without_pagebreaks_falls_back_to_chapter_headings(tmp_path):
    from ayvu.extraction import extract_chapters_from_mobi7_html

    words = " ".join(["palavra"] * 60)
    body = f"<p>Chapter 1: Start</p><p>{words}</p><p>Chapter 2: End</p><p>{words}</p>"
    html_path = tmp_path / "book.html"
    _write_mobi7_html(html_path, body)

    chapters = extract_chapters_from_mobi7_html(str(html_path))
    assert [c.title for c in chapters] == ["Start", "End"]


def test_mobi_dispatch_unpacks_and_cleans_up(tmp_path, monkeypatch):
    import mobi

    from ayvu.extraction import extract_chapters_from_ebook

    unpack_dir = tmp_path / "unpacked"
    (unpack_dir / "mobi7").mkdir(parents=True)
    paragraph = "<p>" + "Kindle book text that is long enough to count. " * 5 + "</p>"
    _write_mobi7_html(
        unpack_dir / "mobi7" / "book.html",
        f"<h1>One</h1>{paragraph}<mbp:pagebreak/><h1>Two</h1>{paragraph}",
    )
    monkeypatch.setattr(mobi, "extract", lambda _path: (str(unpack_dir), str(unpack_dir / "mobi7" / "book.html")))

    chapters = extract_chapters_from_ebook(str(tmp_path / "Book.MOBI"))
    assert [c.title for c in chapters] == ["One", "Two"]
    assert not unpack_dir.exists()


def test_unreadable_mobi_reports_drm_hint(tmp_path):
    import pytest

    from ayvu.extraction import extract_chapters_from_ebook

    bad = tmp_path / "bad.azw3"
    bad.write_bytes(b"not a real kindle file" * 100)
    with pytest.raises(ValueError, match="DRM"):
        extract_chapters_from_ebook(str(bad))


# --- TOC-based chapter splitting (several chapters per file, as in Kindle KF8 / Gutenberg EPUBs) ---

_LONG = "Texto do capítulo com frases suficientes para ser narrado em voz alta. " * 4


def _write_epub_with_anchored_chapters(path):
    from ebooklib import epub

    book = epub.EpubBook()
    book.set_identifier("toc-test")
    book.set_title("TOC Test")
    book.set_language("pt")
    part1 = epub.EpubHtml(title="Parte 1", file_name="Text/part1.xhtml", lang="pt")
    part1.content = (
        "<html><body><p>Prefácio curto, mas com texto suficiente para contar como conteúdo. "
        + _LONG
        + f'</p><p>I</p><h2 id="c1">Do titulo.</h2><p>Um {_LONG}</p>'
        f'<p>II</p><h2 id="c2">Do livro.</h2><p>Dois {_LONG}</p></body></html>'
    )
    part2 = epub.EpubHtml(title="Parte 2", file_name="Text/part2.xhtml", lang="pt")
    part2.content = f"<html><body><p>continuação do segundo. {_LONG}</p><p>III</p><h2 id='c3'>A denuncia.</h2><p>Três {_LONG}</p></body></html>"
    book.add_item(part1)
    book.add_item(part2)
    book.toc = [
        epub.Link("Text/part1.xhtml#c1", "Do titulo.", "c1"),
        epub.Link("Text/part1.xhtml#c2", "Do livro.", "c2"),
        epub.Link("Text/part2.xhtml#c3", "A denuncia.", "c3"),
    ]
    book.spine = [part1, part2]
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    epub.write_epub(str(path), book)


def test_epub_with_several_chapters_per_file_is_split_by_toc(tmp_path):
    from ayvu.extraction import extract_chapters_from_epub

    epub_path = tmp_path / "book.epub"
    _write_epub_with_anchored_chapters(epub_path)
    chapters = extract_chapters_from_epub(str(epub_path))

    assert [c.title for c in chapters] == [None, "Do titulo.", "Do livro.", "A denuncia."]
    assert chapters[0].text.startswith("Prefácio")
    # The roman numeral printed before each anchor moves to the chapter it labels.
    assert chapters[1].text.startswith("I\n")
    assert chapters[2].text.startswith("II\n")
    assert not chapters[1].text.rstrip().endswith("II")
    # Text at the top of the next file (before its first anchor) continues the previous chapter.
    assert "continuação do segundo" in chapters[2].text
    assert chapters[3].text.startswith("III\n")


def test_mobi7_html_uses_toc_ncx_when_present(tmp_path):
    from ayvu.extraction import extract_chapters_from_mobi7_html

    html_path = tmp_path / "book.html"
    _write_mobi7_html(
        html_path,
        f'<p>Cabeçalho</p><mbp:pagebreak/><a id="filepos10" /><p>Do titulo.</p><p>{_LONG}</p>'
        f'<p>II</p><a id="filepos20" /><p>Do livro.</p><p>{_LONG}</p>',
    )
    (tmp_path / "toc.ncx").write_text(
        '<?xml version="1.0"?><ncx><navMap>'
        '<navPoint><navLabel><text>Do titulo.</text></navLabel><content src="book.html#filepos10"/></navPoint>'
        '<navPoint><navLabel><text>Do livro.</text></navLabel><content src="book.html#filepos20"/></navPoint>'
        "</navMap></ncx>",
        encoding="utf-8",
    )
    chapters = extract_chapters_from_mobi7_html(str(html_path))
    assert [c.title for c in chapters] == ["Do titulo.", "Do livro."]
    assert chapters[0].text.startswith("Cabeçalho")  # short preamble folds into the first chapter
    assert chapters[1].text.startswith("II\n")


def test_epub_without_anchored_toc_keeps_one_chapter_per_file(tmp_path):
    from ebooklib import epub

    from ayvu.extraction import extract_chapters_from_epub

    book = epub.EpubBook()
    book.set_identifier("plain")
    book.set_title("Plain")
    items = []
    for idx in (1, 2):
        item = epub.EpubHtml(title=f"C{idx}", file_name=f"c{idx}.xhtml")
        item.content = f"<html><body><h1>Chapter {idx}</h1><p>{_LONG}</p></body></html>"
        book.add_item(item)
        items.append(item)
    book.toc = [epub.Link(f"c{i}.xhtml", f"C{i}", f"c{i}") for i in (1, 2)]
    book.spine = items
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    path = tmp_path / "plain.epub"
    epub.write_epub(str(path), book)

    chapters = extract_chapters_from_epub(str(path))
    assert [c.title for c in chapters] == ["Chapter 1", "Chapter 2"]
