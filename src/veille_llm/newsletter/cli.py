"""`veille-newsletter send`: the weekly mail. Never prints an address."""

import argparse
import os
import sys
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

from veille_llm.newsletter.send import NewsletterError, send_newsletter
from veille_llm.newsletter.smtp import Mailer, SmtpMailer, config_from_env
from veille_llm.newsletter.subscribers import EnvSubscribers, FileSubscribers
from veille_llm.store import Store

_PREVIEW_CONTACT = "unsubscribe@example.org"


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
        smtp_mailer = None
        if not args.dry_run and mailer is None:
            smtp_mailer = SmtpMailer(config_from_env(env))
        active = mailer or smtp_mailer
        contact = env.get("NEWSLETTER_CONTACT") or (_PREVIEW_CONTACT if args.dry_run else "")
        sender = env.get("NEWSLETTER_FROM") or "LLM watch <noreply@example.org>"
        if smtp_mailer is not None:
            smtp_mailer.__enter__()
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
            if smtp_mailer is not None:
                smtp_mailer.__exit__(None, None, None)
    except NewsletterError as exc:
        print(f"newsletter not sent: {exc}")
        return 1
    except ValueError as exc:  # bad configuration (missing SMTP settings, bad contact)
        print(f"configuration error: {exc}")
        return 1
    finally:
        db.close()

    if result.dry_run:
        print(f"dry run: rendered {result.week} into {args.out}")
    elif result.already_sent:
        print(f"{result.week} was already sent, nothing to do")
    else:
        print(f"{result.week}: sent {result.sent} mails")
    return 0


if __name__ == "__main__":
    sys.exit(main())
