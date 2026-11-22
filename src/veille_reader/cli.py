"""veille-reader: run the local reader server (loopback only, never configurable)."""

import argparse
import os
import sys
from pathlib import Path

import uvicorn

from veille_reader.agent import MODEL, sdk_runner, sdk_summarizer
from veille_reader.env import load_env_file, permission_warning
from veille_reader.server import create_app

HOST = "127.0.0.1"
DEV_ORIGINS = "http://127.0.0.1:5173,http://localhost:5173"
ROOT = Path(__file__).resolve().parents[2]  # repo root of the source checkout


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="veille-reader")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="start the local reader server")
    serve.add_argument("--data-dir", type=Path, default=ROOT / ".local/reader")
    serve.add_argument("--catalogue", type=Path, default=ROOT / "build/catalogue.json")
    serve.add_argument("--static", type=Path, default=ROOT / "web/dist")
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument(
        "--env-file",
        type=Path,
        default=ROOT / ".env",
        help="file that may hold CLAUDE_CODE_OAUTH_TOKEN (see make reader-token)",
    )
    serve.add_argument(
        "--reload", action="store_true", help="restart the server when a source file changes"
    )
    serve.add_argument(
        "--dev-front",
        default=None,
        help="with --reload: send the pages to this hot-reload front (the Vite dev server)",
    )
    return parser.parse_args(argv)


def token_status(env_file: Path) -> str:
    """Which Claude login the reader will use (names only: the token is never printed)."""
    loaded = load_env_file(env_file)
    if "CLAUDE_CODE_OAUTH_TOKEN" in loaded:
        return f"Claude login: CLAUDE_CODE_OAUTH_TOKEN loaded from {env_file.name}"
    if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return "Claude login: CLAUDE_CODE_OAUTH_TOKEN from the environment"
    return (
        "Claude login: no CLAUDE_CODE_OAUTH_TOKEN, using your `claude` login session "
        "(`make reader-token` saves a long-lived token if it keeps expiring)"
    )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    print(token_status(args.env_file))
    warning = permission_warning(args.env_file)
    if warning:
        print(f"warning: {warning}", file=sys.stderr)
    static = args.static if args.static.is_dir() else None
    try:
        app = create_app(
            args.data_dir,
            args.catalogue,
            static_dir=static,
            runner=sdk_runner,
            model=MODEL,
            summarizer=sdk_summarizer,
        )
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if args.reload:
        # uvicorn restarts worker processes, which rebuild the app from the environment
        os.environ["VEILLE_READER_DATA_DIR"] = str(args.data_dir)
        os.environ["VEILLE_READER_CATALOGUE"] = str(args.catalogue)
        os.environ["VEILLE_READER_STATIC"] = str(static or "")
        # the Vite dev server (make reader) proxies the API and rewrites the Host header
        os.environ["VEILLE_READER_DEV_ORIGINS"] = DEV_ORIGINS
        os.environ["VEILLE_READER_DEV_FRONT"] = args.dev_front or ""
        os.environ["VEILLE_READER_ENV_FILE"] = str(args.env_file)
        uvicorn.run(
            "veille_reader.cli:reload_app",
            factory=True,
            host=HOST,
            port=args.port,
            reload=True,
            reload_dirs=[str(ROOT / "src")],
        )
        return 0
    uvicorn.run(app, host=HOST, port=args.port)
    return 0


def reload_app():  # noqa: ANN201
    """App factory for `--reload`: same app as `main`, configured through the environment."""
    load_env_file(Path(os.environ.get("VEILLE_READER_ENV_FILE") or ROOT / ".env"))
    static = os.environ.get("VEILLE_READER_STATIC") or None
    return create_app(
        Path(os.environ["VEILLE_READER_DATA_DIR"]),
        Path(os.environ["VEILLE_READER_CATALOGUE"]),
        static_dir=Path(static) if static else None,
        runner=sdk_runner,
        model=MODEL,
        summarizer=sdk_summarizer,
        dev_origins={o for o in os.environ.get("VEILLE_READER_DEV_ORIGINS", "").split(",") if o},
        dev_front=os.environ.get("VEILLE_READER_DEV_FRONT") or None,
    )


if __name__ == "__main__":
    sys.exit(main())
