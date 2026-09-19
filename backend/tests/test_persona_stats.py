import pytest

from src.personas.stats import compute_stats

MESSAGES = ["Maybe we should go!", "Definitely... let's do it \U0001F600\U0001F600", "ok"]


def test_counts_match_hand_computed_values():
    s = compute_stats(MESSAGES)
    # words per message: 4, 4, 1 -> 9 total
    assert s["message_count"] == 3
    assert s["avg_message_length"] == pytest.approx(3.0)
    assert s["emoji_frequency"] == pytest.approx(2 / 3, abs=1e-4)
    assert s["exclamation_frequency"] == pytest.approx(1 / 3, abs=1e-4)
    assert s["ellipsis_frequency"] == pytest.approx(1 / 3, abs=1e-4)
    assert s["hedge_word_ratio"] == pytest.approx(1 / 9, abs=1e-4)  # "maybe"
    assert s["decisive_word_ratio"] == pytest.approx(2 / 9, abs=1e-4)  # "definitely", "let's"


def test_multiword_phrases_curly_apostrophes_and_word_boundaries():
    s = compute_stats(["i think so, not sure"])  # 5 words, hedges: "i think", "not sure"
    assert s["hedge_word_ratio"] == pytest.approx(2 / 5)
    assert compute_stats(["Let’s go"])["decisive_word_ratio"] == pytest.approx(1 / 2)
    assert compute_stats(["mightily impressive"])["hedge_word_ratio"] == 0.0  # not "might"


def test_unicode_ellipsis_counts():
    assert compute_stats(["hmm… ok…"])["ellipsis_frequency"] == pytest.approx(2.0)


def test_sentiment_scores_and_variability():
    s = compute_stats(["I love this, it's wonderful!", "I hate this, it's awful."])
    assert len(s["sentiment_scores"]) == 2
    assert s["sentiment_scores"][0] > 0.5 and s["sentiment_scores"][1] < -0.5
    assert s["sentiment_variance"] > 0.5  # volatile
    steady = compute_stats(["ok", "fine", "sure"])
    assert steady["sentiment_variance"] < 0.05


def test_empty_input_returns_zeros():
    s = compute_stats([])
    assert s["message_count"] == 0 and s["sentiment_scores"] == []
    assert s["avg_message_length"] == 0.0 and s["hedge_word_ratio"] == 0.0


def test_only_emoji_messages_do_not_divide_by_zero():
    s = compute_stats(["\U0001F600", "\U0001F44D"])
    assert s["avg_message_length"] == 0.0
    assert s["hedge_word_ratio"] == 0.0
    assert s["emoji_frequency"] == pytest.approx(1.0)
