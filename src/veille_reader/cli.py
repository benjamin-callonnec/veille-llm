"""veille-reader: run the local reader server (loopback only, never configurable)."""

import argparse
import os
import sys
from pathlib import Path

import uvicorn

from veille_reader.agent import sdk_runner
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
        "--reload", action="store_true", help="restart the server when a source file changes"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    static = args.static if args.static.is_dir() else None
    try:
        app = create_app(args.data_dir, args.catalogue, static_dir=static, runner=sdk_runner)
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
    static = os.environ.get("VEILLE_READER_STATIC") or None
    return create_app(
        Path(os.environ["VEILLE_READER_DATA_DIR"]),
        Path(os.environ["VEILLE_READER_CATALOGUE"]),
        static_dir=Path(static) if static else None,
        runner=sdk_runner,
        dev_origins={o for o in os.environ.get("VEILLE_READER_DEV_ORIGINS", "").split(",") if o},
    )


if __name__ == "__main__":
    sys.exit(main())
