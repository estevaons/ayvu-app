"""PDFs impressos do navegador: títulos espaçados, capitulares, rodapés e capítulos longos."""

from ayvu.extraction import (
    ChapterPayload,
    _extract_pdf_chapter_title,
    clean_pdf_page_lines,
    resolve_drop_caps,
    split_long_chapters,
    split_pdf_text_into_chapters,
    unspace_letter_spaced_line,
)

BODY = " ".join(["palavra"] * 60) + "."


def test_letter_spaced_heading_is_joined():
    assert unspace_letter_spaced_line("C a p í t u l o  1 0") == "Capítulo 10"
    assert unspace_letter_spaced_line("C a p í t u l o 1 2") == "Capítulo 12"
    assert unspace_letter_spaced_line("Um texto normal aqui") == "Um texto normal aqui"
    assert unspace_letter_spaced_line("✦  ✦  ✦") == "✦  ✦  ✦"


def test_em_dash_is_a_title_separator():
    assert _extract_pdf_chapter_title("Capítulo 4 — Todo mundo") == "Todo mundo"


def test_teaser_heading_before_chapter_one_is_dropped():
    text = f"Capítulo 23 — O fim\n{BODY}\nCapítulo 1\nOlho de Pato\n{BODY}\nCapítulo 2\nGente\n{BODY}\nEpílogo\nA garrafa\n{BODY}"
    chapters = split_pdf_text_into_chapters(text)
    assert [title for title, _ in chapters] == ["Olho de Pato", "Gente", "A garrafa"]


def test_print_footers_are_removed_and_drop_cap_reattached():
    page = [
        "C",
        "Capítulo 1",
        "Olho de Pato",
        "ontam esta história de muitos jeitos, e eu mesmo já contei de vários",
        "11/26/26, 4:46 PM O Manto",
        "https://claude.ai/artifact/abc 2/302",
    ]
    cleaned = clean_pdf_page_lines(page)
    assert cleaned[:2] == ["Capítulo 1", "Olho de Pato"]
    assert cleaned[2].startswith("\x01C\x01ontam")
    assert not any("claude.ai" in line for line in cleaned)


def test_drop_cap_join_or_split_follows_the_book():
    text = "\x01C\x01ontam isto. \x01O\x01sorvete chegou. \x01M\x01eu avô. o sorvete, meu avô, contam, eu"
    assert resolve_drop_caps(text).startswith("Contam isto. O sorvete chegou. Meu avô.")


def test_long_chapter_is_split_at_paragraphs():
    paragraphs = [f"Parágrafo {i}. " + "x" * 900 for i in range(30)]
    parts = split_long_chapters([ChapterPayload(title="Livro", text="\n\n".join(paragraphs))], max_chars=10_000)
    assert len(parts) == 3
    assert all(len(p.text) <= 10_000 for p in parts)
    assert [p.title for p in parts] == ["Livro", "Livro (2/3)", "Livro (3/3)"]
    assert "\n\n".join(p.text for p in parts) == "\n\n".join(paragraphs)


def test_short_chapters_are_untouched():
    chapter = ChapterPayload(title=None, text="curto")
    assert split_long_chapters([chapter]) == [chapter]
