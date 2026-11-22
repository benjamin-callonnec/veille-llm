"""veille-reader: run the local reader server (loopback only, never configurable)."""

import argparse
import sys
from pathlib import Path

import uvicorn

from veille_reader.server import create_app

HOST = "127.0.0.1"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="veille-reader")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="start the local reader server")
    serve.add_argument("--data-dir", type=Path, default=Path(".local/reader"))
    serve.add_argument("--catalogue", type=Path, default=Path("build/catalogue.json"))
    serve.add_argument("--static", type=Path, default=Path("web/dist"))
    serve.add_argument("--port", type=int, default=8765)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    static = args.static if args.static.is_dir() else None
    try:
        app = create_app(args.data_dir, args.catalogue, static_dir=static)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    uvicorn.run(app, host=HOST, port=args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
