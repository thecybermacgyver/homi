#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing deployment package: tracked files are not clean." >&2
  exit 1
fi

if test -n "$(git ls-files --others --exclude-standard)"; then
  echo "Refusing deployment package: untracked files are present." >&2
  exit 1
fi

commit="$(git rev-parse HEAD)"
upstream="$(git rev-parse '@{upstream}')"
if test "$commit" != "$upstream"; then
  echo "Refusing deployment package: HEAD is not the pushed upstream commit." >&2
  exit 1
fi

output="${1:-$repo_root/homi-deployment-${commit:0:12}.tar.gz}"
case "$output" in
  /*) ;;
  *) output="$repo_root/$output" ;;
esac
mkdir -p "$(dirname "$output")"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

git archive --format=tar HEAD | tar -xf - -C "$staging"
printf '%s\n' "$commit" > "$staging/.homi-source-commit"

tar -czf "$output" -C "$staging" .
sha256sum "$output"
printf 'DEPLOYMENT_COMMIT=%s\n' "$commit"
printf 'DEPLOYMENT_ARCHIVE=%s\n' "$output"
