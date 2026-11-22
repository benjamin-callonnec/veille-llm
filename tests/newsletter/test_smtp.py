from email.message import EmailMessage

import pytest

from veille_llm.newsletter import smtp as smtp_module
from veille_llm.newsletter.smtp import SmtpConfig, SmtpMailer, config_from_env


class FakeSmtp:
    instances = []

    def __init__(self, host, port, timeout=None, **kw):
        self.host, self.port, self.calls = host, port, []
        FakeSmtp.instances.append(self)

    def starttls(self, **kw):
        self.calls.append("starttls")

    def login(self, user, password):
        self.calls.append(("login", user))

    def send_message(self, message):
        self.calls.append("send")

    def quit(self):
        self.calls.append("quit")


@pytest.fixture(autouse=True)
def fake(monkeypatch):
    FakeSmtp.instances = []
    monkeypatch.setattr(smtp_module.smtplib, "SMTP", FakeSmtp)
    monkeypatch.setattr(smtp_module.smtplib, "SMTP_SSL", FakeSmtp)


def cfg(port):
    return SmtpConfig("smtp.example.org", port, "user", "pw")


def test_port_587_uses_starttls_and_reuses_one_connection():
    with SmtpMailer(cfg(587)) as mailer:
        mailer.send(EmailMessage())
        mailer.send(EmailMessage())
    (conn,) = FakeSmtp.instances
    assert conn.calls == ["starttls", ("login", "user"), "send", "send", "quit"]


def test_port_465_uses_implicit_tls_without_starttls():
    with SmtpMailer(cfg(465)) as mailer:
        mailer.send(EmailMessage())
    assert "starttls" not in FakeSmtp.instances[0].calls


def test_config_from_env_requires_every_variable_and_names_the_missing_ones():
    env = {"SMTP_HOST": "h", "SMTP_PORT": "587", "SMTP_USER": "u", "SMTP_PASSWORD": "p"}
    assert config_from_env(env).host == "h"
    with pytest.raises(ValueError, match="SMTP_PASSWORD"):
        config_from_env({k: v for k, v in env.items() if k != "SMTP_PASSWORD"})


def test_the_password_never_appears_in_the_config_repr():
    assert "pw" not in repr(cfg(587))
