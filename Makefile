.PHONY: install unittest build serve lint check web-install web-check web-build

install:
	uv sync
	$(MAKE) web-install

unittest:
	uv run pytest

lint:
	uv run ruff check --fix src tests
	uv run ruff format src tests

check:
	uv run ruff check src tests
	uv run ruff format --check src tests
	uv run pytest
	$(MAKE) web-check

web-install:
	cd web && npm ci

web-check:
	cd web && npm run check

web-build:
	cd web && npm run build

build:
	uv run veille-llm --days 7

serve:
	uv run python -m http.server 8000 --directory site
