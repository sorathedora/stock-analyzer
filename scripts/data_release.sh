#!/usr/bin/env bash
# Sync files in data/ with the "data" GitHub release.
#   scripts/data_release.sh download [pattern...]   # default: every asset
#   scripts/data_release.sh upload [pattern...]     # default: every file in data/
# Patterns are globs such as 'prices_*' or 'results.parquet'.
set -euo pipefail
TAG=data
cmd=$1
shift
patterns=("$@")

case "$cmd" in
  download)
    mkdir -p data
    if ! gh release view "$TAG" >/dev/null 2>&1; then
      echo "No data release yet; starting empty"
      exit 0
    fi
    if [ ${#patterns[@]} -eq 0 ]; then
      gh release download "$TAG" --dir data --clobber
    else
      for p in "${patterns[@]}"; do
        gh release download "$TAG" --dir data --clobber --pattern "$p" || echo "No asset matching $p yet"
      done
    fi
    ;;
  upload)
    if ! gh release view "$TAG" >/dev/null 2>&1; then
      gh release create "$TAG" --title "Data" --notes "Pipeline output, replaced on every run."
    fi
    shopt -s nullglob
    files=()
    if [ ${#patterns[@]} -eq 0 ]; then
      files=(data/*)
    else
      for p in "${patterns[@]}"; do files+=(data/$p); done
    fi
    # One file at a time, with retries: --clobber deletes the old copy first,
    # so a GitHub server error mid-upload would otherwise lose the file.
    failed=0
    for f in "${files[@]}"; do
      if [ ! -f "$f" ]; then
        echo "Skipping $f: not created by this run"
        continue
      fi
      for attempt in 1 2 3 4; do
        if gh release upload "$TAG" "$f" --clobber; then
          break
        fi
        if [ "$attempt" -eq 4 ]; then
          echo "Giving up on $f" >&2
          failed=1
        else
          sleep $((attempt * 10))
        fi
      done
    done
    exit $failed
    ;;
  *)
    echo "usage: $0 download|upload [pattern...]" >&2
    exit 1
    ;;
esac
