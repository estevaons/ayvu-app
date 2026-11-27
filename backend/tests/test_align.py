"""Finding paragraph and line starts in narrated audio from its silences."""

import random

import numpy as np

from ayvu.align import align_spans, find_silences, timings_from_silences


def synthetic(weights, *, seed=0, decoys=True):
    """Speech spans with ~0.9 s pauses between them, and shorter pauses inside."""
    rnd = random.Random(seed)
    t, spans, silences = 0.0, [], []
    for i, w in enumerate(weights):
        if i:
            gap = rnd.uniform(0.82, 1.1)
            silences.append((round(t, 2), round(gap, 2)))
            t += gap
        length = w / 17 * rnd.uniform(0.85, 1.15) + 0.25
        spans.append((t, t + length))
        if decoys:
            # Sentence pauses inside the paragraph, now and then almost as long as a break.
            for _ in range(int(length // 6)):
                at = t + rnd.uniform(0.1, 0.9) * length
                silences.append((round(at, 2), round(rnd.choice([0.3, 0.4, 0.5, 0.6, 0.78]), 2)))
        t += length
    silences.sort()
    return spans, silences, t


def test_align_spans_finds_every_paragraph_break():
    rnd = random.Random(1)
    weights = [rnd.choice([8, 15, 40, 120, 300, 700, 1000]) for _ in range(120)]
    truth, silences, duration = synthetic(weights)
    got = align_spans(weights, 0.0, duration, [s for s in silences if s[1] >= 0.5])
    assert len(got) == len(weights)
    misses = [i for i, (a, b) in enumerate(got) if abs(b - truth[i][1]) > 0.05]
    assert not misses


def test_align_spans_without_enough_silences_splits_by_length():
    assert align_spans([1, 3], 0.0, 8.0, []) == [(0.0, 2.0), (2.0, 8.0)]


def test_find_silences():
    sr = 8000
    speech = np.sin(np.linspace(0, 2000, sr)).astype(np.float32) * 0.3  # 1 s of "speech"
    pcm = np.concatenate([speech, np.zeros(int(sr * 0.9), np.float32), speech, np.zeros(int(sr * 0.1), np.float32), speech])
    found = find_silences(pcm, sr)
    assert len(found) == 1
    start, length = found[0]
    assert abs(start - 1.0) < 0.03 and abs(length - 0.9) < 0.05


def test_timings_from_silences_shape():
    text = "Capítulo 1\n\nUma frase curta. Outra frase.\n\nFim."
    lens = [10, 29, 4]
    truth, silences, duration = synthetic(lens, decoys=False)
    timings = timings_from_silences(text, espeak=True, duration=duration, silences=silences)
    assert [[seg[2] for seg in p] for p in timings] == [["Capítulo 1"], ["Uma frase curta. Outra frase."], ["Fim."]]
    assert abs(timings[1][0][0] - truth[1][0]) < 0.05
    assert timings[-1][-1][1] == round(duration, 3)
