import re
import statistics

from emoji import emoji_count
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

_WORD_RE = re.compile(r"[\w']+")
_ELLIPSIS_RE = re.compile(r"\.{3,}|…")

_HEDGES = [
    "maybe", "perhaps", "guess", "probably", "possibly", "might", "kinda", "sorta", "idk",
    "not sure", "i think", "kind of", "sort of", "i suppose",
]
_DECISIVE = [
    "definitely", "absolutely", "certainly", "obviously", "always", "already", "exactly",
    "let's", "lets", "for sure", "no doubt", "gotta", "must",
]


def _phrase_regex(phrases: list[str]) -> re.Pattern:
    alternatives = "|".join(r"\s+".join(map(re.escape, p.split())) for p in phrases)
    return re.compile(rf"\b(?:{alternatives})\b")


_HEDGE_RE = _phrase_regex(_HEDGES)
_DECISIVE_RE = _phrase_regex(_DECISIVE)

_analyzer = SentimentIntensityAnalyzer()


def compute_stats(messages: list[str]) -> dict:
    """Style statistics over one person's messages.

    Units: avg_message_length is words per message; emoji/exclamation/ellipsis
    frequencies are occurrences per message (each "!" and each "..." counts);
    the two word ratios are matched words-or-phrases divided by total words.
    sentiment_scores are VADER compound scores in [-1, 1], one per message.
    """
    n = len(messages)
    if n == 0:
        return {
            "message_count": 0,
            "avg_message_length": 0.0,
            "emoji_frequency": 0.0,
            "exclamation_frequency": 0.0,
            "ellipsis_frequency": 0.0,
            "hedge_word_ratio": 0.0,
            "decisive_word_ratio": 0.0,
            "sentiment_scores": [],
            "avg_sentiment": 0.0,
            "sentiment_variance": 0.0,
        }

    normalized = [m.lower().replace("’", "'") for m in messages]
    total_words = sum(len(_WORD_RE.findall(m)) for m in normalized)
    scores = [_analyzer.polarity_scores(m)["compound"] for m in messages]

    def ratio(pattern: re.Pattern) -> float:
        if total_words == 0:
            return 0.0
        return sum(len(pattern.findall(m)) for m in normalized) / total_words

    stats = {
        "message_count": n,
        "avg_message_length": total_words / n,
        "emoji_frequency": sum(emoji_count(m) for m in messages) / n,
        "exclamation_frequency": sum(m.count("!") for m in messages) / n,
        "ellipsis_frequency": sum(len(_ELLIPSIS_RE.findall(m)) for m in messages) / n,
        "hedge_word_ratio": ratio(_HEDGE_RE),
        "decisive_word_ratio": ratio(_DECISIVE_RE),
        "sentiment_scores": scores,
        "avg_sentiment": statistics.fmean(scores),
        "sentiment_variance": statistics.pvariance(scores),
    }
    return {
        k: [round(x, 4) for x in v] if isinstance(v, list) else round(v, 4) if isinstance(v, float) else v
        for k, v in stats.items()
    }
