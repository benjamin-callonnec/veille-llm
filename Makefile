.PHONY: install unittest build serve lint

install:
	uv sync

unittest:
	uv run pytest

lint:
	uv run ruff check --fix src tests
	uv run ruff format src tests

build:
	uv run veille-llm --days 7

serve:
	uv run python -m http.server 8000 --directory site
