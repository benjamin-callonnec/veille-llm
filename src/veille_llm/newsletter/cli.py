"""`veille-newsletter send`: the weekly mail. Never prints an address."""

import argparse
import email.utils
import os
import re
import sys
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

from veille_llm.newsletter.select import week_id
from veille_llm.newsletter.send import NewsletterError, send_newsletter
from veille_llm.newsletter.smtp import Mailer, SmtpMailer, config_from_env
from veille_llm.newsletter.subscribers import (
    EnvSubscribers,
    FileSubscribers,
    parse_addresses,
)
from veille_llm.store import Store

_PREVIEW_CONTACT = "unsubscribe@example.org"
_PREVIEW_SENDER = "LLM watch <noreply@example.org>"
_WEEK = re.compile(r"^\d{4}-W\d{2}$")


def _valid_sender(raw: str) -> bool:
    """One plain address, with an optional display name, and no control characters."""
    if not raw or any(ord(c) < 32 or ord(c) == 127 for c in raw):
        return False
    found = email.utils.getaddresses([raw])
    return len(found) == 1 and len(parse_addresses(found[0][1])[0]) == 1


def main(
    argv: list[str] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    mailer: Mailer | None = None,
    now: datetime | None = None,
) -> int:
    env = os.environ if env is None else env
    parser = argparse.ArgumentParser(prog="veille-newsletter", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    send = sub.add_parser("send", help="send this week's newsletter (once per week)")
    send.add_argument("--db", type=Path, default=Path("veille.db"))
    send.add_argument("--week", help="ISO week id such as 2026-W48 (default: this week)")
    send.add_argument("--dry-run", action="store_true", help="render only, send nothing")
    send.add_argument("--out", type=Path, default=Path("build"), help="dry-run output folder")
    args = parser.parse_args(argv)
    current_week = week_id(now or datetime.now(UTC))
    if args.week and not _WEEK.fullmatch(args.week):
        print("configuration error: --week must look like 2026-W48")
        return 1
    if args.week and args.week != current_week and not args.dry_run:
        print("configuration error: refusing to send a week other than the current week")
        return 1
    sender = env.get("NEWSLETTER_FROM", "")
    if args.dry_run and not sender:
        sender = _PREVIEW_SENDER
    if not _valid_sender(sender):
        print("configuration error: NEWSLETTER_FROM must be one plain address (Name <a@b.org>)")
        return 1

    store = (
        EnvSubscribers(env) if "SUBSCRIBERS" in env else FileSubscribers(Path("subscribers.txt"))
    )
    addresses = store.list()
    if env.get("GITHUB_ACTIONS") == "true":
        for address in addresses:  # before any other output
            print(f"::add-mask::{address}")
    if store.rejected:
        print(f"{store.rejected} invalid subscriber entries ignored")

    db = Store(args.db)
    try:
        active = mailer
        if not args.dry_run and active is None:
            active = SmtpMailer(config_from_env(env))
        contact = env.get("NEWSLETTER_CONTACT") or (_PREVIEW_CONTACT if args.dry_run else "")
        try:
            result = send_newsletter(
                db,
                subscribers=addresses,
                mailer=active,
                now=now or datetime.now(UTC),
                contact=contact,
                sender=sender,
                week=args.week,
                dry_run=args.dry_run,
                out_dir=args.out,
            )
        finally:
            if isinstance(active, SmtpMailer):
                active.__exit__(None, None, None)
    except NewsletterError as exc:
        print(f"newsletter not sent: {exc}")
        return 1
    except ValueError as exc:  # bad configuration (missing SMTP settings, bad contact)
        print(f"configuration error: {exc}")
        return 1
    finally:
        db.close()

    if result.nothing_to_send:
        print(f"{result.week}: nothing interesting this week, no mail sent")
    elif result.dry_run:
        print(f"dry run: rendered {result.week} into {args.out}")
    elif result.already_sent:
        print(f"{result.week} was already sent, nothing to do")
    else:
        skipped = f", {result.skipped} refused by the server" if result.skipped else ""
        print(f"{result.week}: sent {result.sent} mails{skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
