#!/bin/sh
# Build a folder you can push to a Hugging Face Docker Space.
set -e
cd "$(dirname "$0")/.."
rm -rf dist/space
mkdir -p dist/space
cp -r Dockerfile .dockerignore pyproject.toml uv.lock src fixtures demo dist/space/
cp deploy/space_readme.md dist/space/README.md
find dist/space -name __pycache__ -type d -prune -exec rm -rf {} +
echo "Ready: dist/space"
