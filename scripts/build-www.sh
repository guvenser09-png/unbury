#!/bin/bash
# Builds the Capacitor web bundle: copies the game into www/, strips dev hooks.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf www
mkdir -p www
cp index.html privacy.html www/ 2>/dev/null || cp index.html www/
cp -R src www/src
# strip debug hooks from the native bundle
sed -i '' '/window.__fl = /d; /window.__FL = /d' www/src/main.js
echo "www/ built: $(find www -type f | wc -l | tr -d ' ') files"
