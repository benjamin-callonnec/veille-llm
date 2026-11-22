"""Send the weekly newsletter once per week, resuming after a partial failure.

Addresses are never logged, stored or put in an error message: failures name the position of
the recipient only. The progress marker in the database is a pair of counts.
"""

from dataclasses import dataclass
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path

from veille_llm.newsletter.render import Mail, render
from veille_llm.newsletter.select import MIN_ITEMS, select_items, week_id
from veille_llm.newsletter.smtp import Mailer
from veille_llm.store import Store


class NewsletterError(Exception):
    """Nothing was sent (or sending stopped); the message never contains an address."""


@dataclass
class SendResult:
    week: str
    sent: int = 0
    already_sent: bool = False
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
    if len(items) < MIN_ITEMS:
        raise NewsletterError(f"only {len(items)} items this week, at least {MIN_ITEMS} needed")
    mail = render(items, week=week, contact=contact, now=now)

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

    start = min(progress[0], len(recipients)) if progress else 0
    for index in range(start, len(recipients)):
        try:
            mailer.send(build_message(mail, sender=sender, recipient=recipients[index]))
        except Exception as exc:  # noqa: BLE001 - the original text may contain the address
            raise NewsletterError(
                f"delivery failed at recipient #{index + 1} of {len(recipients)} "
                f"({type(exc).__name__}); {index} of them already got it"
            ) from None
        store.record_delivery(week, delivered=index + 1, total=len(recipients))
        result.sent += 1
    return result
