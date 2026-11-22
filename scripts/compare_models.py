"""Compare a model against the verdicts already stored (made by Sonnet) on a sample.

Run: env -u ANTHROPIC_API_KEY uv run python scripts/compare_models.py build/test.db \
         [--model claude-haiku-5-5] [--batches 3]
Re-classifies `--batches` x 15 items (balanced interesting/rejected) with the model and prints
agreement with the stored verdicts, the score gap, token usage and cost. Read-only on the DB.
"""

import argparse
import asyncio
import random
import sqlite3
import sys

from veille_llm.llm import DEFAULT_MODEL, LlmError, RawReply, claude_runner
from veille_llm.models import Item
from veille_llm.pipeline.classify import BATCH_SIZE, classify_batch


def sample(db: str, size: int) -> tuple[list[Item], dict[str, tuple[int, int]]]:
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    rows = con.execute(
        "SELECT i.id, i.source, i.kind, i.title, i.summary, i.url, i.published,"
        " v.interesting, v.score FROM items i JOIN verdicts v ON v.item_id = i.id"
    ).fetchall()
    random.Random(0).shuffle(rows)  # fixed seed: same sample for every model
    half = size // 2
    pick = [r for r in rows if r[7]][:half] + [r for r in rows if not r[7]][: size - half]
    items = [Item(r[0], r[1], r[2], r[3], r[4], r[5], [], r[6]) for r in pick]
    return items, {r[0]: (r[7], r[8]) for r in pick}


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("db")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--batches", type=int, default=3)
    args = ap.parse_args()
    items, ref = sample(args.db, args.batches * BATCH_SIZE)

    totals = {"in": 0, "out": 0, "cost": 0.0}

    async def metered(prompt, options) -> RawReply:
        reply = await claude_runner(prompt, options)
        totals["in"] += reply.input_tokens
        totals["out"] += reply.output_tokens
        totals["cost"] += reply.cost_usd or 0.0
        return reply

    agree = gap = n = 0
    false_pos, false_neg = [], []
    try:
        for s in range(0, len(items), BATCH_SIZE):
            batch = items[s : s + BATCH_SIZE]
            for v in await classify_batch(batch, runner=metered, model=args.model):
                want, score = ref[v.item_id]
                n += 1
                agree += int(v.interesting) == want
                gap += abs(v.score - score)
                title = next(i.title for i in batch if i.id == v.item_id)[:70]
                if v.interesting and not want:
                    false_pos.append(title)
                if want and not v.interesting:
                    false_neg.append(title)
    except LlmError as exc:
        print(f"STOPPED: {type(exc).__name__}: {exc}")
        return 1
    print(
        f"model={args.model} items={n} agreement={agree}/{n} mean_score_gap={gap / max(n, 1):.2f}"
    )
    print(f"tokens in={totals['in']} out={totals['out']} indicative_cost=${totals['cost']:.4f}")
    print("Haiku keeps what Sonnet rejected:", *false_pos, sep="\n  - ")
    print("Haiku rejects what Sonnet kept:", *false_neg, sep="\n  - ")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
