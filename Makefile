.PHONY: tf-init tf-validate tf-plan tf-apply tf-apply-ci scheduler-install scheduler-check scheduler-deploy scheduler-secret catalogue reader reader-build reader-token subs-add subs-remove subs-list subs-push install unittest serve lint check web-install web-check web-build

install:
	uv sync --locked
	$(MAKE) web-install
	$(MAKE) scheduler-install

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
	$(MAKE) scheduler-check

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

# The published catalogue (what the daily pipeline built, with hooks and briefs), for local use.
# `build/catalogue.json` is only a copy: refresh it with `make catalogue`.
CATALOGUE_URL ?= https://benjamin-callonnec.github.io/veille-llm/catalogue.json
catalogue:
	@mkdir -p build
	@curl -fsS --max-time 60 "$(CATALOGUE_URL)" -o build/catalogue.json.tmp || { rm -f build/catalogue.json.tmp; echo "could not download $(CATALOGUE_URL)"; exit 1; }
	@python3 -c "import json; d = json.load(open('build/catalogue.json.tmp')); assert d['items'], 'no items'" || { rm -f build/catalogue.json.tmp; echo "the downloaded catalogue is not valid"; exit 1; }
	@mv build/catalogue.json.tmp build/catalogue.json
	@echo "build/catalogue.json refreshed from $(CATALOGUE_URL)"

# Local paper reader (#17): never built by CI or published on Pages.
# `make reader` runs both servers with auto-reload: the API restarts when a Python file changes and
# the front hot-reloads (Vite). Open the "Read" links from http://127.0.0.1:5173.
# The reader answers on the Claude subscription: variables that would bill per token (or send the
# calls to another provider) are removed for these processes only.
READER_NO_BILLING = -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL \
	-u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX
READER_PORT ?= 8765
FRONT_PORT ?= 5173
READER_FRONT_URL ?= http://127.0.0.1:$(FRONT_PORT)
reader:
	@for port in $(READER_PORT) $(FRONT_PORT); do \
	  pid=$$(lsof -nP -tiTCP:$$port -sTCP:LISTEN 2>/dev/null | head -1); \
	  if [ -n "$$pid" ]; then \
	    echo "Port $$port is already used by PID $$pid ($$(ps -o command= -p $$pid | cut -c1-80))."; \
	    echo "A leftover reader may survive its terminal: kill -9 $$pid, then run make reader again."; \
	    exit 1; \
	  fi; \
	done
	@test -f build/catalogue.json || $(MAKE) catalogue
	@# Port $(READER_PORT) serves web/dist: rebuild it so it is never an older version than the dev server.
	@cd web && VITE_READER_URL=$(READER_FRONT_URL) npx vite build --mode reader --logLevel warn
	@echo ""
	@echo "Reader: open $(READER_FRONT_URL)  (hot reload; http://127.0.0.1:$(READER_PORT) sends you there too)."
	@echo "Ctrl+C stops both."
	@trap 'kill 0' INT TERM EXIT; \
	(cd web && VITE_READER_URL=$(READER_FRONT_URL) npx vite --mode reader --host 127.0.0.1 --port $(FRONT_PORT) --strictPort) & \
	env $(READER_NO_BILLING) uv run veille-reader serve --port $(READER_PORT) --reload --dev-front $(READER_FRONT_URL) & \
	wait

# The reader needs a long-lived Claude token (the interactive login session expires and then the chat
# fails with "OAuth session expired"). Run `claude setup-token` in a terminal, then `make reader-token`
# to paste it: it goes to .env (git ignores it, mode 600) and is never printed.
reader-token:
	@uv run python scripts/reader_token.py

# One process, no auto-reload: builds the front once and serves it from the API server.
reader-build:
	@test -f build/catalogue.json || $(MAKE) catalogue
	cd web && VITE_READER_URL=http://127.0.0.1:8765 npx vite build --mode reader
	env $(READER_NO_BILLING) uv run veille-reader serve

# Citation evaluation of the reader's tutor (#31): real PDFs, real tutor, on the subscription.
# Example: make eval-reader ARGS="--limit 3". Results go to evals/results/ (git ignores them).
eval-reader:
	env $(READER_NO_BILLING) uv run python scripts/eval_reader.py $(ARGS)

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

# Cloudflare Worker that dispatches daily.yml and weekly.yml at the right time (#38).
# Run these from the repo root: they cd into scheduler/ (where wrangler.toml lives) themselves.
scheduler-install:
	cd scheduler && npm ci --ignore-scripts

scheduler-check:
	cd scheduler && npm run check

scheduler-deploy:
	cd scheduler && npx wrangler deploy

scheduler-secret:
	cd scheduler && npx wrangler secret put GITHUB_TOKEN

# Terraform of the scheduler (iac/): crons and state. $(TF_ENV) starts every command that needs the
# credentials, in the same shell: it loads .env.cloudflare when it exists (CI has no file, its
# variables are already set; make runs /bin/sh, hence `.` and not `source`), stops at once naming
# the first variable that is missing, and maps the R2_STATE_* keys to the AWS_* names that
# Terraform's S3 backend requires. See setup/README.md.
TF_ENV = set -a; if [ -f .env.cloudflare ]; then . ./.env.cloudflare; fi; set +a; \
	for name in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID R2_STATE_ACCESS_KEY_ID R2_STATE_SECRET_ACCESS_KEY; do \
		eval "value=\$$$$name"; \
		test -n "$$value" || { echo "$$name is not set: see setup/README.md"; exit 1; }; \
	done; \
	export TF_VAR_cloudflare_api_token="$$CLOUDFLARE_API_TOKEN" \
		TF_VAR_cloudflare_account_id="$$CLOUDFLARE_ACCOUNT_ID" \
		AWS_ACCESS_KEY_ID="$$R2_STATE_ACCESS_KEY_ID" \
		AWS_SECRET_ACCESS_KEY="$$R2_STATE_SECRET_ACCESS_KEY";

tf-init:
	$(TF_ENV) cd iac && terraform init -backend-config="endpoints={s3=\"https://$$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com\"}"

tf-validate:
	cd iac && terraform init -backend=false && terraform validate && terraform fmt -check

tf-plan:
	$(TF_ENV) cd iac && terraform plan

tf-apply:
	$(TF_ENV) cd iac && terraform apply

tf-apply-ci:
	$(TF_ENV) cd iac && terraform apply -auto-approve
