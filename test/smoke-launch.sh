#!/bin/bash
# Smoke test: verify the Electron app starts without crashing
npx electron . &
APP_PID=$!
sleep 5
if kill -0 "$APP_PID" 2>/dev/null; then
  echo "PASS: app started successfully (PID $APP_PID)"
  kill "$APP_PID" 2>/dev/null
  wait "$APP_PID" 2>/dev/null
  exit 0
else
  echo "FAIL: app crashed on startup"
  wait "$APP_PID" 2>/dev/null
  exit 1
fi
