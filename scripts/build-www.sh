#!/bin/bash
# Builds the Capacitor web bundle: copies the game into www/, strips dev hooks.
# COPYFILE_DISABLE + junk cleanup: AppleDouble (._*) or .DS_Store files inside
# the app bundle are a classic cause of ITMS-90035 invalid-signature rejects.
set -euo pipefail
export COPYFILE_DISABLE=1
cd "$(dirname "$0")/.."
rm -rf www
mkdir -p www
cp index.html www/
cp privacy.html www/ 2>/dev/null || true
cp -R src www/src
find www -name '.DS_Store' -delete
find www -name '._*' -delete
# strip debug hooks from the native bundle
sed -i '' '/window.__fl = /d; /window.__FL = /d' www/src/main.js
echo "www/ built: $(find www -type f | wc -l | tr -d ' ') files"
