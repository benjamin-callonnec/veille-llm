"""SMTP delivery: one connection reused for every recipient, TLS always on."""

import smtplib
import ssl
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


class RecipientRefused(Exception):
    """The server refused this one recipient; the message never contains the address."""


class SmtpMailer:
    """Connects lazily on the first message, so a week with nothing to send never logs in."""

    def __init__(self, config: SmtpConfig) -> None:
        self._config = config
        self._conn: smtplib.SMTP | None = None

    def _connect(self) -> smtplib.SMTP:
        c = self._config
        context = ssl.create_default_context()  # verifies the certificate and the hostname
        if c.port == 465:
            conn: smtplib.SMTP = smtplib.SMTP_SSL(c.host, c.port, timeout=30, context=context)
        else:
            conn = smtplib.SMTP(c.host, c.port, timeout=30)
            conn.starttls(context=context)
        conn.login(c.user, c.password)
        return conn

    def __enter__(self) -> "SmtpMailer":
        return self

    def __exit__(self, *exc: object) -> None:
        if self._conn is not None:
            try:
                self._conn.quit()
            except Exception:  # noqa: BLE001 - mail already sent, closing is best effort
                pass

    def send(self, message: EmailMessage) -> None:
        if self._conn is None:
            self._conn = self._connect()
        try:
            self._conn.send_message(message)
        except smtplib.SMTPRecipientsRefused:
            raise RecipientRefused("recipient refused by the server") from None
