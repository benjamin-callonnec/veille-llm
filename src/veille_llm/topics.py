"""Keyword-based topic classification of papers."""

from __future__ import annotations

import re

TOPICS: dict[str, tuple[str, ...]] = {
    "transformers": (
        r"transformers?",
        r"self-attention",
        r"attention mechanism",
        r"mixture[- ]of[- ]experts",
        r"\bmoe\b",
        r"kv[- ]cache",
        r"long[- ]context",
        r"positional (?:encoding|embedding)s?",
    ),
    "alt-architectures": (
        r"state[- ]space models?",
        r"\bssms?\b",
        r"mamba",
        r"rwkv",
        r"retnet",
        r"linear attention",
        r"sub-?quadratic",
        r"hybrid architectures?",
        r"diffusion language models?",
    ),
    "lstm-rnn": (
        r"\blstms?\b",
        r"\bxlstm\b",
        r"\bgrus?\b",
        r"recurrent neural networks?",
        r"\brnns?\b",
    ),
    "encoder-decoder": (
        r"encoder[- ]decoder",
        r"seq2seq",
        r"sequence[- ]to[- ]sequence",
        r"encoder[- ]only",
        r"decoder[- ]only",
        r"\bt5\b",
        r"\bbert\b",
    ),
    "agents": (
        r"llm[- ]based agents?",
        r"llm agents?",
        r"agentic",
        r"multi-agent",
        r"tool[- ]use",
        r"function calling",
        r"language agents?",
    ),
    "knowledge-graphs": (
        r"knowledge graphs?",
        r"graph-?rag",
        r"\bkgs?\b",
        r"ontolog(?:y|ies)",
        r"graph retrieval",
    ),
}

TOPIC_LABELS: dict[str, str] = {
    "transformers": "Transformers",
    "alt-architectures": "Alt. architectures",
    "lstm-rnn": "LSTM / RNN",
    "encoder-decoder": "Encoder-decoder",
    "agents": "Agents LLM",
    "knowledge-graphs": "Knowledge graphs",
}

_PATTERNS = {
    topic: re.compile("|".join(keywords), re.IGNORECASE) for topic, keywords in TOPICS.items()
}


def classify(title: str, summary: str) -> list[str]:
    """Topics whose keywords appear in the title or the abstract, in TOPICS order."""
    text = f"{title}\n{summary}"
    return [topic for topic, pattern in _PATTERNS.items() if pattern.search(text)]
