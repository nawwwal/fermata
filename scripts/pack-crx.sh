#!/usr/bin/env bash
# Pack Fermata into a signed CRX3 — used both locally and in CI.
#
# The CRX is built by Chrome itself (--pack-extension), so it is a genuine
# CRX3 with a stable extension ID derived from the signing key. The same key
# must be used every time or the ID (and every user's install) changes.
#
# Inputs (env):
#   CHROME   path to a Chrome / Chrome for Testing binary (auto-detected if unset)
#   CRX_KEY  path to the RSA private key PEM (default: ./key.pem)
#
# Output: dist/fermata-<version>.crx  and a copy at  dist/fermata.crx
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

key="${CRX_KEY:-$root/key.pem}"
if [ ! -f "$key" ]; then
  echo "error: signing key not found at $key" >&2
  echo "generate one with:  openssl genrsa 2048 > key.pem   (keep it secret)" >&2
  exit 1
fi

# Locate a Chrome binary if one was not handed to us.
chrome="${CHROME:-}"
if [ -z "$chrome" ]; then
  for c in \
    "google-chrome" "google-chrome-stable" "chromium" "chromium-browser" \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    /Users/*/Library/Caches/ms-playwright/chromium-*/chrome-mac*/"Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"; do
    if command -v "$c" >/dev/null 2>&1; then chrome="$c"; break; fi
    if [ -x "$c" ]; then chrome="$c"; break; fi
  done
fi
if [ -z "$chrome" ]; then
  echo "error: no Chrome binary found; set CHROME=/path/to/chrome" >&2
  exit 1
fi

version="$(node -p "require('./manifest.json').version" 2>/dev/null \
  || sed -n 's/.*"version"[: ]*"\([^"]*\)".*/\1/p' manifest.json | head -1)"

# Stage only the files the extension actually ships — never the repo chrome
# (.agents, README, tests, the key itself).
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT          # never leave staged copies behind
pkg="$stage/fermata"
mkdir -p "$pkg"
cp manifest.json "$pkg/"
cp -R src pages icons "$pkg/"

# belt-and-suspenders: refuse to package the signing key or any secret material
if [ -e "$pkg/key.pem" ] || [ -e "$pkg/.env" ] || ls "$pkg"/*.pem >/dev/null 2>&1; then
  echo "error: refusing to package secret material found in the stage" >&2
  exit 1
fi

rm -rf "$root/dist"
mkdir -p "$root/dist"

# --pack-extension writes <stage>/fermata.crx next to the staged dir.
"$chrome" --pack-extension="$pkg" --pack-extension-key="$key" \
  --no-sandbox >/dev/null 2>&1 || true

if [ ! -f "$stage/fermata.crx" ]; then
  echo "error: Chrome did not produce a CRX (key invalid, or Chrome too old?)" >&2
  exit 1
fi
# integrity guard, shared by local and CI: a real CRX3 starts with "Cr24"
if [ "$(head -c 4 "$stage/fermata.crx")" != "Cr24" ]; then
  echo "error: produced file is not a valid CRX3 (bad magic)" >&2
  exit 1
fi

out="$root/dist/fermata-$version.crx"
mv "$stage/fermata.crx" "$out"
cp "$out" "$root/dist/fermata.crx"
rm -rf "$stage"

echo "built $out"
ls -la "$root/dist"
