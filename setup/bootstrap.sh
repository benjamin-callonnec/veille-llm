#!/usr/bin/env bash
# Creates the R2 bucket that stores the Terraform state (veille-llm-tfstate).
# Idempotent: does nothing if the bucket exists. Run once, before any `terraform init`
# (see setup/README.md). Needs wrangler to be logged in or CLOUDFLARE_API_TOKEN set.
set -euo pipefail

BUCKET_NAME="veille-llm-tfstate"

if ! command -v wrangler >/dev/null 2>&1; then
  echo "wrangler (Cloudflare CLI) is required: npm install -g wrangler" >&2
  exit 1
fi

if wrangler r2 bucket list | grep -q "${BUCKET_NAME}"; then
  echo "Bucket ${BUCKET_NAME} already exists, nothing to do."
else
  wrangler r2 bucket create "${BUCKET_NAME}"
  echo "Bucket ${BUCKET_NAME} created."
fi
