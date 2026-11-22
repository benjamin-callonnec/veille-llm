"""SMTP delivery: one connection reused for every recipient, TLS always on."""

import smtplib
from collections.abc import Mapping
from dataclasses import dataclass, field
from email.message import EmailMessage
from typing import Protocol

_REQUIRED = ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD")


class Mailer(Protocol):
    def send(self, message: EmailMessage) -> None: ...


@dataclass(frozen=True)
class SmtpConfig:
    host: str
    port: int
    user: str
    password: str = field(repr=False)  # never shown in logs or tracebacks


def config_from_env(env: Mapping[str, str]) -> SmtpConfig:
    missing = [name for name in _REQUIRED if not env.get(name)]
    if missing:
        raise ValueError(f"missing SMTP settings: {', '.join(missing)}")
    return SmtpConfig(
        env["SMTP_HOST"], int(env["SMTP_PORT"]), env["SMTP_USER"], env["SMTP_PASSWORD"]
    )


class SmtpMailer:
    def __init__(self, config: SmtpConfig) -> None:
        self._config = config
        self._conn: smtplib.SMTP | None = None

    def __enter__(self) -> "SmtpMailer":
        c = self._config
        if c.port == 465:
            self._conn = smtplib.SMTP_SSL(c.host, c.port, timeout=30)
        else:
            self._conn = smtplib.SMTP(c.host, c.port, timeout=30)
            self._conn.starttls()
        self._conn.login(c.user, c.password)
        return self

    def __exit__(self, *exc: object) -> None:
        if self._conn is not None:
            try:
                self._conn.quit()
            except smtplib.SMTPException:
                pass

    def send(self, message: EmailMessage) -> None:
        assert self._conn is not None, "use SmtpMailer as a context manager"
        self._conn.send_message(message)
