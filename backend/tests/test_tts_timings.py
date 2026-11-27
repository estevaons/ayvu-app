"""Timings recorded during narration line up with the audio the writer receives."""

from types import SimpleNamespace

import numpy as np

from ayvu import tts


class FakeWriter:
    def __init__(self, output_path):
        self.samples = 0

    def write(self, audio):
        self.samples += len(audio)

    def silence(self, seconds):
        self.samples += int(tts.SAMPLE_RATE * seconds)

    def close(self):
        return self.samples / tts.SAMPLE_RATE

    def abort(self):
        pass


def fake_pipeline(text, voice, speed, split_pattern):
    for line in text.split("\n"):
        # One second of audio per 10 characters.
        yield SimpleNamespace(graphemes=f"  {line}  ", audio=np.zeros(len(line) * tts.SAMPLE_RATE // 10))


def test_timings_follow_audio(monkeypatch, tmp_path):
    monkeypatch.setattr(tts, "Mp3Writer", FakeWriter)
    engine = object.__new__(tts.KokoroEngine)
    engine.pipeline = lambda lang_code: fake_pipeline
    timings: list = []
    text = "Primeira frase aqui. Segunda frase.\n\nOutro parágrafo."
    duration = engine.narrate_to_mp3(text, voice="pf_dora", output_path=tmp_path / "x.mp3", timings=timings)

    assert len(timings) == 2
    first, second = timings
    assert [s[2] for s in first] == ["Primeira frase aqui. Segunda frase."]
    assert first[0][0] == 0 and first[0][1] == 3.5
    # Paragraph pause before the second paragraph.
    assert second[0][0] == round(3.5 + tts.PARAGRAPH_PAUSE_SECONDS, 3)
    assert second[0][2] == "Outro parágrafo."
    assert second[-1][1] == round(duration, 3)


def test_timings_optional(monkeypatch, tmp_path):
    monkeypatch.setattr(tts, "Mp3Writer", FakeWriter)
    engine = object.__new__(tts.KokoroEngine)
    engine.pipeline = lambda lang_code: fake_pipeline
    assert engine.narrate_to_mp3("Olá.", voice="pf_dora", output_path=tmp_path / "x.mp3") > 0
