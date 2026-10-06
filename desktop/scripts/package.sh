#!/usr/bin/env bash
# Builds marrow.app into out/ and zips it. Usage: scripts/package.sh [arm64|x64]
# (default: this machine's). Ad-hoc signed only; see "Mac app" in the README.
set -euo pipefail
cd "$(dirname "$0")/.."
arch="${1:-$(uname -m | sed 's/x86_64/x64/')}"
version="$(node -p 'require("../package.json").version')"

npm --prefix .. run build
npm run build
scripts/stage.sh
npx electron-packager . marrow --out=out --overwrite \
  --arch="$arch" --app-version="$version" \
  --icon=assets/icon.icns --app-bundle-id=com.srtfisher.marrow \
  --extra-resource=build/marrow \
  --ignore='^/(src|tests|scripts|assets|build|out|tsconfig.*)'
app="out/marrow-darwin-$arch/marrow.app"
# Packager leaves Electron's own ad-hoc signature, identifier "Electron". macOS
# refuses notifications when that does not match the bundle id, so sign again.
codesign --force --deep --sign - --identifier com.srtfisher.marrow "$app"
# ditto, not zip: it keeps the symlinks and extended attributes the bundle needs.
zip_path="out/marrow-$version-mac-$arch.zip"
ditto -c -k --keepParent "$app" "$zip_path"
echo "$zip_path"
