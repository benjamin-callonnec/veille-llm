"""Progress output for long runs: one log line per LLM batch, groups, heartbeat, step summary.

GitHub Actions has no terminal, so there are no carriage-return bars: each line stands alone
in the log. Only counts, durations and costs are ever printed, never item text or secrets.
"""

import asyncio
import time
from collections.abc import Callable
from pathlib import Path
from typing import TextIO


def format_duration(seconds: float) -> str:
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m{seconds % 60:02d}s"
    return f"{seconds // 3600}h{(seconds % 3600) // 60:02d}m"


class Progress:
    def __init__(
        self,
        stream: TextIO,
        *,
        github: bool = False,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.stream, self.github, self._clock = stream, github, clock
        self.phase = "starting"
        self._start = self._phase_start = 0.0

    def start(self) -> None:
        self._start = self._phase_start = self._clock()

    def _print(self, line: str) -> None:
        print(line, file=self.stream, flush=True)

    def group(self, title: str) -> None:
        self.phase = title
        self._phase_start = self._clock()
        self._print(f"::group::{title}" if self.github else f"== {title} ==")

    def endgroup(self) -> None:
        if self.github:
            self._print("::endgroup::")

    def info(self, line: str) -> None:
        self._print(line)

    def batch(
        self, kind: str, index: int, total: int, *, items: int, tokens: int, cost: float
    ) -> None:
        now = self._clock()
        per_batch = (now - self._phase_start) / max(index, 1)
        eta = format_duration(per_batch * max(total - index, 0))
        self._print(
            f"[{kind}] batch {index}/{total} · items {items} · {tokens:,} tokens · "
            f"${cost:.4f} · elapsed {format_duration(now - self._start)} · eta {eta}"
        )

    async def heartbeat(self, interval: float = 60.0) -> None:
        """Print a line every `interval` seconds so a silent run is still visibly alive."""
        while True:
            await asyncio.sleep(interval)
            elapsed = format_duration(self._clock() - self._start)
            self._print(f"... still running ({self.phase}, elapsed {elapsed})")

    def write_summary(
        self, path: Path, counts: dict[str, float], *, capped: bool, stopped: str | None
    ) -> None:
        """Append a Markdown summary (for `$GITHUB_STEP_SUMMARY`)."""
        rows = "\n".join(
            f"| {name} | {value:.4f} |" if isinstance(value, float) else f"| {name} | {value} |"
            for name, value in counts.items()
        )
        notes = []
        if capped:
            notes.append("Batch limit reached: the rest resumes on the next run.")
        if stopped:
            notes.append(f"**STOPPED**: {stopped}")
        text = "## veille-core run\n\n| step | count |\n|---|---|\n" + rows + "\n"
        if notes:
            text += "\n" + "\n\n".join(notes) + "\n"
        with path.open("a", encoding="utf-8") as handle:
            handle.write(text)
