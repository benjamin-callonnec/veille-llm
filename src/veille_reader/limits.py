"""The agent limiter: how long one answer and one conversation may run (tool limits: tools.py)."""

from dataclasses import dataclass


@dataclass(frozen=True)
class AgentLimits:
    max_turns: int = 8  # model turns in one answer (each tool round trip is one)
    max_message_usd: float = 0.50  # cost of one answer, as reported by the SDK
    max_session_usd: float = 3.00  # cost of one conversation
