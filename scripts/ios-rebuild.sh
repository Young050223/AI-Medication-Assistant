#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE="$ROOT_DIR/ios/App/App.xcworkspace"
PROJECT="$ROOT_DIR/ios/App/App.xcodeproj"
DERIVED_DATA="$ROOT_DIR/ios/DerivedData"
SCHEME="App"

cd "$ROOT_DIR"

echo "[ios-rebuild] Build web assets..."
npm run build

echo "[ios-rebuild] Sync Capacitor iOS..."
npx cap sync ios

echo "[ios-rebuild] Xcode clean ($SCHEME)..."
if ! xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Debug -derivedDataPath "$DERIVED_DATA" clean; then
  echo "[ios-rebuild] Workspace clean failed; retry with project file..."
  xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug -derivedDataPath "$DERIVED_DATA" clean
fi

echo "[ios-rebuild] Done."
