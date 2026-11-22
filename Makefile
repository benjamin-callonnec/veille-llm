.PHONY: subs-add subs-remove subs-list subs-push install unittest serve lint check web-install web-check web-build

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

# Subscribers: local subscribers.txt (gitignored), pushed to the SUBSCRIBERS secret.
subs-add:
	@uv run python scripts/subs.py add "$(EMAIL)"

subs-remove:
	@uv run python scripts/subs.py remove "$(EMAIL)"

subs-list:
	@uv run python scripts/subs.py list

subs-push:
	@uv run python scripts/subs.py push
