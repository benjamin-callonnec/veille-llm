.PHONY: install unittest serve lint check web-install web-check web-build

install:
	uv sync --locked
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
	cd web && npm ci --ignore-scripts

web-check:
	cd web && npm run check

web-build:
	cd web && npm run build

serve: web-build
	@test -f build/catalogue.json || { echo "build/catalogue.json missing: run veille-core first"; exit 1; }
	cp build/catalogue.json web/dist/catalogue.json
	cd web/dist && python3 -m http.server 8000
