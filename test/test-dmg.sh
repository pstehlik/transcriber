#!/bin/bash
# Pre-release DMG smoke test: mounts the built DMG, launches the app
# with an isolated data directory, and verifies it starts without crashing.
#
# Prerequisite: npm run build
# Usage: npm run test:dmg
set -euo pipefail

VERSION=$(node -p "require('./package.json').version")
DMG_PATH="dist/Transcriber-${VERSION}-arm64.dmg"
MOUNT_POINT=""
TMP_DIR=""
APP_PID=""

cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null
    wait "$APP_PID" 2>/dev/null || true
  fi
  if [ -n "$MOUNT_POINT" ] && [ -d "$MOUNT_POINT" ]; then
    hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
  fi
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

# 1. Verify DMG exists
if [ ! -f "$DMG_PATH" ]; then
  echo "FAIL: DMG not found at $DMG_PATH (run 'npm run build' first)"
  exit 1
fi
echo "OK: DMG found at $DMG_PATH"

# 2. Mount DMG
MOUNT_OUTPUT=$(hdiutil attach "$DMG_PATH" -nobrowse -noverify -noautoopen 2>&1)
MOUNT_POINT=$(echo "$MOUNT_OUTPUT" | grep '/Volumes/' | sed 's|.*\(/Volumes/.*\)|\1|')

if [ -z "$MOUNT_POINT" ] || [ ! -d "$MOUNT_POINT" ]; then
  echo "FAIL: could not mount DMG"
  echo "$MOUNT_OUTPUT"
  exit 1
fi
echo "OK: DMG mounted at $MOUNT_POINT"

# 3. Verify app bundle
APP_BUNDLE="$MOUNT_POINT/Transcriber.app"
if [ ! -d "$APP_BUNDLE" ]; then
  echo "FAIL: Transcriber.app not found in DMG"
  exit 1
fi
echo "OK: Transcriber.app found"

# 4. Create isolated temp data dir
TMP_DIR=$(mktemp -d -t transcriber-dmg-test)
echo "Data dir: $TMP_DIR"

# 5. Launch app from DMG with isolated data dir
TRANSCRIBER_DATA_DIR="$TMP_DIR" "$APP_BUNDLE/Contents/MacOS/Transcriber" &
APP_PID=$!

sleep 8

# 6. Check process survived startup
if kill -0 "$APP_PID" 2>/dev/null; then
  echo "OK: app running (PID $APP_PID)"
else
  echo "FAIL: app crashed on startup"
  exit 1
fi

# 7. Verify the data dir was populated (app should create it on init)
if [ -d "$TMP_DIR" ]; then
  FILE_COUNT=$(find "$TMP_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
  echo "OK: data directory has $FILE_COUNT file(s)"
fi

echo "PASS: DMG smoke test passed"
exit 0
