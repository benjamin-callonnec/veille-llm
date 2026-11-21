"""Write the catalogue JSON atomically; never replace a good export with an empty one."""

from __future__ import annotations

import json
import os
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

from veille_llm.store import Store

_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def export_catalogue(store: Store, path: Path, *, now: datetime, window_days: int = 30) -> bool:
    since = (now - timedelta(days=window_days)).strftime(_FORMAT)
    items = store.published_items(since)
    path = Path(path)
    if not items and path.exists():
        return False
    counts = Counter(item["category"] for item in items)
    categories = [
        {"name": name, "count": count}
        for name, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]
    payload = {
        "generated_at": now.strftime(_FORMAT),
        "window_days": window_days,
        "categories": categories,
        "items": items,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)
    return True
