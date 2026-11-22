.PHONY: reader subs-add subs-remove subs-list subs-push install unittest serve lint check web-install web-check web-build

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

# Local paper reader (#17): never built by CI or published on Pages.
READER_URL ?= http://127.0.0.1:8765
reader:
	@test -f build/catalogue.json || { echo "build/catalogue.json missing: run veille-core first"; exit 1; }
	cd web && VITE_READER_URL=$(READER_URL) npx vite build --mode reader
	uv run veille-reader serve

# Subscribers: local subscribers.txt (gitignored), pushed to the SUBSCRIBERS secret.
subs-add:
	@test -n "$(EMAIL)" || { echo "usage: make subs-add EMAIL=someone@example.org"; exit 1; }
	@uv run python scripts/subs.py add "$(EMAIL)"

subs-remove:
	@test -n "$(EMAIL)" || { echo "usage: make subs-remove EMAIL=someone@example.org"; exit 1; }
	@uv run python scripts/subs.py remove "$(EMAIL)"

subs-list:
	@uv run python scripts/subs.py list

subs-push:
	@uv run python scripts/subs.py push
