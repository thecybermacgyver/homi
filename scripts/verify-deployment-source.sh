#!/usr/bin/env bash
set -euo pipefail

expected="${1:-}"
if test -z "$expected"; then
  echo "Usage: $0 <expected-full-commit-sha>" >&2
  exit 2
fi

if test ! -f .homi-source-commit; then
  echo "Refusing deployment: .homi-source-commit is missing." >&2
  exit 1
fi

actual="$(tr -d '\r\n' < .homi-source-commit)"
if test "$actual" != "$expected"; then
  echo "Refusing deployment: source commit $actual does not match $expected." >&2
  exit 1
fi

for required in Dockerfile.web deploy/nginx.conf deploy/nginx-security-headers.conf apps/web/src/main.tsx apps/web/index.html; do
  if test ! -f "$required"; then
    echo "Refusing deployment: required file $required is missing." >&2
    exit 1
  fi
done

echo "DEPLOYMENT_SOURCE_VERIFIED=$actual"
