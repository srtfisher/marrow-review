#!/usr/bin/env bash
# Copies the built CLI and its production dependencies into build/marrow,
# which packaging ships as Resources/marrow. Run the root build first.
set -euo pipefail
cd "$(dirname "$0")/.."
test -f ../dist/cli.js || { echo "no ../dist/cli.js: run the root build first" >&2; exit 1; }
rm -rf build/marrow
mkdir -p build/marrow
cp -R ../dist build/marrow/dist
# The root's package-lock.json is not maintained (bun.lock is), so install from
# the manifest with dev dependencies and scripts stripped.
node -e 'const p = require("../package.json"); delete p.devDependencies; delete p.scripts; require("fs").writeFileSync("build/marrow/package.json", JSON.stringify(p, null, 2));'
(cd build/marrow && npm install --omit=dev --ignore-scripts --no-package-lock --no-audit --no-fund)
# The app runs the machine's Claude Code (--claude-path), so the SDK's own
# 270 MB copy is dead weight.
rm -rf build/marrow/node_modules/@anthropic-ai/claude-agent-sdk-*
