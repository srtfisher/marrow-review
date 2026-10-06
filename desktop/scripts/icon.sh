#!/usr/bin/env bash
# Renders assets/icon.svg into assets/icon.icns. Needs rsvg-convert (brew install librsvg).
set -euo pipefail
cd "$(dirname "$0")/.."
set_dir="$(mktemp -d)/icon.iconset"
mkdir -p "$set_dir"
for size in 16 32 128 256 512; do
  rsvg-convert -w "$size" -h "$size" assets/icon.svg -o "$set_dir/icon_${size}x${size}.png"
  rsvg-convert -w "$((size * 2))" -h "$((size * 2))" assets/icon.svg -o "$set_dir/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$set_dir" -o assets/icon.icns
rm -rf "$(dirname "$set_dir")"
echo "assets/icon.icns"
