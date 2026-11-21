.PHONY: install unittest build serve lint check

install:
	uv sync

unittest:
	uv run pytest

lint:
	uv run ruff check --fix src tests
	uv run ruff format src tests

check:
	uv run ruff check src tests
	uv run ruff format --check src tests
	uv run pytest

build:
	uv run veille-llm --days 7

serve:
	uv run python -m http.server 8000 --directory site
