from ayvu.extraction import extract_chapters_from_ebook
from ayvu.metadata import read_metadata


def test_txt_is_split_on_chapter_headings(tmp_path):
    words = " ".join(["palavra"] * 60)
    path = tmp_path / "book.txt"
    path.write_text(f"Capítulo 1: Começo\n\n{words}\n\nCapítulo 2: Fim\n\n{words}\n", encoding="cp1252")
    chapters = extract_chapters_from_ebook(str(path))
    assert [c.title for c in chapters] == ["Começo", "Fim"]


def test_txt_without_headings_is_one_chapter(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_text(" ".join(["word"] * 80), encoding="utf-8")
    chapters = extract_chapters_from_ebook(str(path))
    assert len(chapters) == 1 and chapters[0].title is None


def test_epub_metadata_and_cover(tmp_path):
    import io

    from ebooklib import epub
    from PIL import Image

    png = io.BytesIO()
    Image.new("RGB", (1200, 1800), "#c8a96e").save(png, format="PNG")
    book = epub.EpubBook()
    book.set_identifier("meta")
    book.set_title("Dom Casmurro")
    book.add_author("Machado de Assis")
    book.set_cover("cover.png", png.getvalue())
    chapter = epub.EpubHtml(title="I", file_name="c1.xhtml")
    chapter.content = "<html><body><h1>I</h1><p>" + "texto " * 50 + "</p></body></html>"
    book.add_item(chapter)
    book.spine = [chapter]
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    path = tmp_path / "book.epub"
    epub.write_epub(str(path), book)

    meta = read_metadata(str(path))
    assert meta.title == "Dom Casmurro"
    assert meta.author == "Machado de Assis"
    assert meta.cover_jpeg and meta.cover_jpeg[:2] == b"\xff\xd8"
    with Image.open(io.BytesIO(meta.cover_jpeg)) as img:
        assert max(img.size) <= 900


def test_metadata_of_unknown_format_is_empty(tmp_path):
    path = tmp_path / "x.txt"
    path.write_text("hello")
    meta = read_metadata(str(path))
    assert meta.title is None and meta.cover_jpeg is None
