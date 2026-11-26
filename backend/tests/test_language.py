import pytest

from ayvu.language import (
    UnsupportedLanguageError,
    detect_supported_book_language,
    detect_text_language,
    normalize_language_code,
    resolve_voice,
)
from ayvu.tts import paragraphs_for_narration, prepare_text_for_espeak

PT_TEXT = (
    "Naquela manhã de outono, a cidade acordou coberta por uma neblina espessa que escondia os telhados. "
    "Joana abriu a janela da cozinha, preparou o café e ficou observando as pessoas que passavam apressadas "
    "pela calçada molhada. Ela pensava na carta que tinha recebido na semana anterior, escrita por um tio "
    "distante que dizia ter encontrado documentos antigos da família guardados no sótão de uma casa no interior. "
    "Durante muitos anos ninguém se lembrou daquela casa, mas agora tudo parecia voltar com uma força estranha. "
)
EN_TEXT = (
    "On that autumn morning the town woke up under a thick fog that hid every rooftop from view. "
    "Joan opened the kitchen window, made some coffee and watched the people hurrying along the wet sidewalk. "
    "She kept thinking about the letter she had received the week before, written by a distant uncle who "
    "claimed to have found old family papers stored in the attic of a house in the countryside. "
    "For many years nobody remembered that house, but now everything seemed to come back with a strange force. "
)
DE_TEXT = (
    "An jenem Herbstmorgen erwachte die Stadt unter einem dichten Nebel, der alle Dächer verbarg. "
    "Johanna öffnete das Küchenfenster, kochte Kaffee und beobachtete die Leute, die über den nassen Gehweg eilten. "
    "Sie dachte an den Brief, den sie in der Woche zuvor erhalten hatte, geschrieben von einem entfernten Onkel, "
    "der behauptete, alte Familienpapiere auf dem Dachboden eines Hauses auf dem Land gefunden zu haben. "
    "Viele Jahre lang hatte niemand an dieses Haus gedacht, aber jetzt schien alles mit seltsamer Kraft zurückzukehren. "
)


def test_normalize_language_code():
    assert normalize_language_code("pt-BR") == "pt"
    assert normalize_language_code("en_US") == "en"
    assert normalize_language_code("zh-cn") == "zh"
    assert normalize_language_code(None) == ""


@pytest.mark.parametrize(("text", "expected"), [(PT_TEXT, "pt"), (EN_TEXT, "en"), (DE_TEXT, "de")])
def test_detect_text_language_uses_majority_of_samples(text, expected):
    detection = detect_text_language(text * 20)
    assert detection.code == expected
    assert detection.samples == 10
    assert detection.votes >= 6


def test_detection_is_not_fooled_by_english_front_matter():
    # A translated book often starts with an English copyright page.
    text = EN_TEXT * 2 + PT_TEXT * 40
    assert detect_supported_book_language(text).code == "pt"


def test_unsupported_language_raises_with_detected_code():
    with pytest.raises(UnsupportedLanguageError) as exc_info:
        detect_supported_book_language(DE_TEXT * 20)
    assert exc_info.value.detected_language == "de"
    assert exc_info.value.code == "unsupported_language"


def test_prepare_text_for_espeak_keeps_lines_short_and_sentences_whole():
    long_sentence = "uma " * 150 + "frase longa sem pontuação, com vírgula " + "e mais " * 40 + "fim."
    text = f"Primeira frase. Segunda frase!\n\n{long_sentence}\nÚltima linha?"
    lines = prepare_text_for_espeak(text, max_chars=200).split("\n")
    assert lines[0] == "Primeira frase. Segunda frase!"
    assert lines[-1] == "Última linha?"
    assert all(0 < len(line) <= 200 for line in lines)
    assert " ".join(lines).split() == text.split()


def test_resolve_voice_keeps_a_voice_of_the_same_language():
    assert resolve_voice("en", "bm_george") == "bm_george"
    assert resolve_voice("pt-BR", "pm_alex") == "pm_alex"


def test_resolve_voice_falls_back_to_language_default():
    assert resolve_voice("pt", "af_heart") == "pf_dora"
    assert resolve_voice("en", None) == "af_heart"


def test_resolve_voice_rejects_unsupported_language():
    with pytest.raises(UnsupportedLanguageError):
        resolve_voice("de", None)


def test_paragraphs_for_english_join_wrapped_lines():
    text = "First line of a\nparagraph.\n\nSecond paragraph."
    assert paragraphs_for_narration(text, espeak=False) == ["First line of a paragraph.", "Second paragraph."]


def test_paragraphs_for_espeak_are_split_into_short_lines():
    text = ("Uma frase curta. " * 40).strip() + "\n\nOutro parágrafo."
    paragraphs = paragraphs_for_narration(text, espeak=True)
    assert len(paragraphs) == 2
    assert all(len(line) <= 280 for line in paragraphs[0].split("\n"))
