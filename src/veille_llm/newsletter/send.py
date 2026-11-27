"""Send the weekly newsletter once per week, resuming after a partial failure.

Addresses are never logged, stored or put in an error message: failures name the position of
the recipient only. The progress marker in the database is a pair of counts.
"""

from dataclasses import dataclass
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path

from veille_llm.newsletter.render import Mail, render
from veille_llm.newsletter.select import MIN_ITEMS, select_items, select_sections, week_id
from veille_llm.newsletter.smtp import Mailer, RecipientRefused
from veille_llm.store import Store


class NewsletterError(Exception):
    """Nothing was sent (or sending stopped); the message never contains an address."""


@dataclass
class SendResult:
    week: str
    sent: int = 0
    skipped: int = 0
    already_sent: bool = False
    nothing_to_send: bool = False
    dry_run: bool = False


def build_message(mail: Mail, *, sender: str, recipient: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient  # one recipient per message, never a list
    message["Subject"] = mail.subject
    message["List-Unsubscribe"] = f"<mailto:{mail.unsubscribe}>"
    message.set_content(mail.text)
    message.add_alternative(mail.html, subtype="html")
    return message


def send_newsletter(
    store: Store,
    *,
    subscribers: list[str],
    mailer: Mailer | None,
    now: datetime,
    contact: str,
    sender: str,
    week: str | None = None,
    dry_run: bool = False,
    out_dir: Path | None = None,
) -> SendResult:
    week = week or week_id(now)
    result = SendResult(week=week, dry_run=dry_run)
    recipients = sorted(subscribers)
    progress = store.newsletter_progress(week)
    if not dry_run and progress and progress[1] > 0 and progress[0] >= progress[1]:
        result.already_sent = True
        return result

    items = select_items(store, now)
    if not items or len(items) < MIN_ITEMS:
        result.nothing_to_send = True  # quiet week: no mail, no error, no marker
        return result
    sections = select_sections(store, now, exclude={i["id"] for i in items})
    mail = render(items, week=week, contact=contact, now=now, sections=sections)

    if dry_run:
        out = out_dir or Path("build")
        out.mkdir(parents=True, exist_ok=True)
        (out / "newsletter.html").write_text(mail.html, encoding="utf-8")
        (out / "newsletter.txt").write_text(mail.text, encoding="utf-8")
        return result

    if not recipients:
        raise NewsletterError("no subscribers")
    if mailer is None:
        raise NewsletterError("no mailer configured")

    start = 0
    if progress:
        if progress[1] != len(recipients):
            raise NewsletterError(
                "the subscriber list changed since the failed run "
                f"({progress[1]} then, {len(recipients)} now): resuming would skip or double "
                "someone; fix the list or wait for next week"
            )
        start = progress[0]
    for index in range(start, len(recipients)):
        try:
            mailer.send(build_message(mail, sender=sender, recipient=recipients[index]))
            result.sent += 1
        except RecipientRefused:
            result.skipped += 1  # one bad address must not block the others, now or next week
        except Exception as exc:  # noqa: BLE001 - the original text may contain the address
            raise NewsletterError(
                f"delivery failed at recipient #{index + 1} of {len(recipients)} "
                f"({type(exc).__name__}); {index} of them already got it"
            ) from None
        store.record_delivery(week, delivered=index + 1, total=len(recipients))
    return result
