#!/bin/bash
# Builds the CrazyGames portal package: dist/portal/ + dist/unbury-crazygames.zip
# Differences from the web/native build:
#   - CrazyGames SDK v3 script tag injected into <head>
#   - window.FL_PORTAL = true (drops the external share URL — portal rule:
#     no off-site links inside the portal build)
#   - debug hooks already stripped by build-www.sh
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/build-www.sh
rm -rf dist/portal dist/unbury-crazygames.zip
mkdir -p dist/portal
cp -R www/. dist/portal/

sed -i '' 's#<head>#<head>\
<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>\
<script>window.FL_PORTAL = true;</script>#' dist/portal/index.html
grep -q 'crazygames-sdk' dist/portal/index.html || { echo "SDK injection failed"; exit 1; }

find dist/portal -name '.DS_Store' -delete
find dist/portal -name '._*' -delete
(cd dist/portal && zip -rqX ../unbury-crazygames.zip .)

FILES=$(find dist/portal -type f | wc -l | tr -d ' ')
SIZE=$(du -h dist/unbury-crazygames.zip | cut -f1)
echo "portal package: dist/unbury-crazygames.zip ($SIZE, $FILES files)"
