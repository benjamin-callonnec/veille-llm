"""Spike: classify 3 fake items with the Claude Agent SDK on the subscription.

Run: env -u ANTHROPIC_API_KEY uv run python scripts/spike_llm.py
Prints the JSON, token usage and cost. Exits 1 with the error type on any LlmError.
"""

import asyncio
import json
import os
import sys

from veille_llm.llm import LlmError, complete_json

SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "interesting": {"type": "boolean"},
                    "category": {"type": "string"},
                    "hook": {"type": "string"},
                },
                "required": ["id", "interesting", "category", "hook"],
            },
        }
    },
    "required": ["items"],
}

PROMPT = """Classify each item: is it interesting for a watch on LLM architectures and news?
Give a short category and a one-sentence hook (empty hook if not interesting).
Items:
- id=a1: "Mamba-3: improved state space models for long sequences" (arXiv paper)
- id=a2: "A lab announces a new open-weights reasoning model with benchmark results" (news)
- id=a3: "My grandmother's apple pie recipe" (blog post)
Return {"items": [...]} with one entry per item."""


async def main() -> int:
    try:
        result = await complete_json(PROMPT, SCHEMA)
    except LlmError as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result.data, indent=2, ensure_ascii=False))
    summary = (
        f"tokens in={result.input_tokens} out={result.output_tokens} cost_usd={result.cost_usd}"
    )
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as fh:
            fh.write(f"### LLM spike\n\n{summary}\n")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
