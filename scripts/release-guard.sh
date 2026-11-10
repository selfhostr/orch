#!/bin/sh
# Release guard: run by .github/workflows/release.yml before anything is built or pushed.
# usage: release-guard.sh <tag> <commit-sha> <owner/repo>
# Needs git (with origin/main fetched) and gh (GH_TOKEN with actions: read).
# Fails unless the tag is a version tag, its commit is on main, and every finished workflow run
# of that commit succeeded (CI included). Writes stable=true|false to $GITHUB_OUTPUT: only a
# stable version (no pre-release suffix) may move the `latest` image tag.
set -eu

tag="${1:?tag}"
sha="${2:?commit sha}"
repo="${3:?owner/repo}"

if ! printf '%s\n' "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
  echo "::error::tag $tag is not a version tag (vX.Y.Z or vX.Y.Z-suffix)"
  exit 1
fi

if ! git merge-base --is-ancestor "$sha" origin/main; then
  echo "::error::commit $sha is not on main: tag only a commit that was merged into main"
  exit 1
fi

# The Release workflow itself runs on this commit, so it is left out of the check.
runs="$(gh api "repos/$repo/actions/runs?head_sha=$sha&per_page=100" \
  --jq '.workflow_runs[] | select(.name != "Release") | [.name, (.conclusion // "pending")] | @tsv')"

if ! printf '%s\n' "$runs" | grep -q '^CI	'; then
  echo "::error::no CI run found for commit $sha"
  exit 1
fi

bad="$(printf '%s\n' "$runs" | awk -F '\t' 'NF && $2 != "success" && $2 != "skipped" { print "  " $1 ": " $2 }')"
if [ -n "$bad" ]; then
  echo "::error::CI is not green for commit $sha:"
  printf '%s\n' "$bad"
  exit 1
fi

case "$tag" in
  *-*) stable=false ;;
  *) stable=true ;;
esac
echo "Release guard passed for $tag ($sha), stable=$stable"
[ -z "${GITHUB_OUTPUT:-}" ] || echo "stable=$stable" >>"$GITHUB_OUTPUT"
