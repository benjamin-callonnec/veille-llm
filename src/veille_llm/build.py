"""Build `site/data.json`: recent arXiv papers on the watched topics, with HF upvotes."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from veille_llm.arxiv import Paper, fetch_recent
from veille_llm.hf import fetch_upvotes
from veille_llm.topics import TOPIC_LABELS, classify


def build_payload(papers: list[Paper], upvotes: dict[str, int], now: datetime) -> dict:
    items = []
    for paper in papers:
        topics = classify(paper.title, paper.summary)
        if not topics:
            continue
        items.append(
            {
                "id": paper.arxiv_id,
                "title": paper.title,
                "summary": paper.summary,
                "authors": paper.authors,
                "published": paper.published,
                "url": paper.url,
                "topics": topics,
                "upvotes": upvotes.get(paper.arxiv_id, 0),
            }
        )
    items.sort(key=lambda item: item["published"], reverse=True)
    return {
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "topics": TOPIC_LABELS,
        "papers": items,
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--out", type=Path, default=Path("site/data.json"))
    args = parser.parse_args(argv)

    papers = fetch_recent(args.days)
    payload = build_payload(papers, fetch_upvotes(), datetime.now(UTC))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(payload['papers'])} papers kept out of {len(papers)} fetched -> {args.out}")


if __name__ == "__main__":
    main()
