#!/usr/bin/env bash
# Stop hook: run `make check` when Python files changed.
# Exit 2 blocks the stop and feeds stderr back to Claude.
set -u

input="$(cat)"

# Never loop: if a previous stop hook already blocked, let Claude stop.
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$PWD}" || exit 0

changed="$(git status --porcelain --untracked-files=all 2>/dev/null | awk '{print $NF}' | grep -E '\.py$' || true)"
if [ -z "$changed" ]; then
  exit 0
fi

output="$(make check 2>&1)"
status=$?
if [ "$status" -ne 0 ]; then
  {
    echo "make check failed (exit $status). Fix the problems below before stopping:"
    printf '%s\n' "$output" | tail -n 40
  } >&2
  exit 2
fi
exit 0
