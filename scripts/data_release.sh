#!/usr/bin/env bash
# Sync the local data/ folder with the "data" GitHub release.
#   scripts/data_release.sh download
#   scripts/data_release.sh upload
set -euo pipefail
TAG=data

case "$1" in
  download)
    mkdir -p data
    if gh release view "$TAG" >/dev/null 2>&1; then
      gh release download "$TAG" --dir data --clobber
    else
      echo "No data release yet; starting empty"
    fi
    ;;
  upload)
    if ! gh release view "$TAG" >/dev/null 2>&1; then
      gh release create "$TAG" --title "Data" --notes "Pipeline output, replaced on every run."
    fi
    gh release upload "$TAG" data/* --clobber
    ;;
  *)
    echo "usage: $0 download|upload" >&2
    exit 1
    ;;
esac
