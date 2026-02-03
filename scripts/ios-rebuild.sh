#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE="$ROOT_DIR/ios/App/App.xcworkspace"
SCHEME="App"

cd "$ROOT_DIR"

echo "[ios-rebuild] Build web assets..."
npm run build

echo "[ios-rebuild] Sync Capacitor iOS..."
npx cap sync ios

echo "[ios-rebuild] Xcode clean ($SCHEME)..."
xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Debug clean

echo "[ios-rebuild] Done."
