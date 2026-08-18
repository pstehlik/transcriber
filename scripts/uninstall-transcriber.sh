#!/bin/bash
#
# Transcriber — uninstall / reset
#
# Removes everything Transcriber installed so the app can be set up from
# scratch. Run it in Terminal:
#
#   bash ~/Downloads/uninstall-transcriber.sh
#
# Options:
#   --keep-models   keep the downloaded Whisper model weights (saves re-download)
#   --keep-app      keep /Applications/Transcriber.app (reset data only)
#   --yes           don't ask, just do it
#   --dry-run       show what would be removed, delete nothing
#
set -u

KEEP_MODELS=0
KEEP_APP=0
ASSUME_YES=0
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --keep-models) KEEP_MODELS=1 ;;
    --keep-app)    KEEP_APP=1 ;;
    --yes|-y)      ASSUME_YES=1 ;;
    --dry-run)     DRY_RUN=1 ;;
    -h|--help)     sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)"; exit 1 ;;
  esac
done

DATA_DIR="$HOME/.transcriber"
APP_SUPPORT="$HOME/Library/Application Support/Transcriber"
SAVED_STATE="$HOME/Library/Saved Application State/com.pstehlik.transcriber.savedState"
PREFS="$HOME/Library/Preferences/com.pstehlik.transcriber.plist"
LOGS="$HOME/Library/Logs/Transcriber"
APP="/Applications/Transcriber.app"
HF_HUB="${HF_HOME:-$HOME/.cache/huggingface}/hub"

TARGETS=()
[ -e "$DATA_DIR" ]    && TARGETS+=("$DATA_DIR")
[ -e "$APP_SUPPORT" ] && TARGETS+=("$APP_SUPPORT")
[ -e "$SAVED_STATE" ] && TARGETS+=("$SAVED_STATE")
[ -e "$PREFS" ]       && TARGETS+=("$PREFS")
[ -e "$LOGS" ]        && TARGETS+=("$LOGS")
[ $KEEP_APP -eq 0 ] && [ -e "$APP" ] && TARGETS+=("$APP")

# Whisper model weights live in the shared Hugging Face cache. Only the
# whisper-* directories are touched — anything else in that cache belongs
# to other tools and is left alone.
MODEL_COUNT=0
if [ $KEEP_MODELS -eq 0 ] && [ -d "$HF_HUB" ]; then
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    TARGETS+=("$d")
    MODEL_COUNT=$((MODEL_COUNT + 1))
  done < <(find "$HF_HUB" -maxdepth 1 -type d -name 'models--mlx-community--whisper-*' 2>/dev/null)
fi

if [ ${#TARGETS[@]} -eq 0 ]; then
  echo "Nothing to remove — Transcriber doesn't appear to be installed."
  exit 0
fi

echo "This will remove:"
echo
for t in "${TARGETS[@]}"; do
  printf '  %-8s %s\n' "$(du -sh "$t" 2>/dev/null | cut -f1)" "$t"
done
echo
echo "Note: this deletes your transcript history, settings, the WhatsApp link,"
echo "      and any WhatsApp voice messages the app downloaded."
if [ $MODEL_COUNT -gt 0 ]; then
  echo "      Model weights will need to be downloaded again on first launch"
  echo "      (use --keep-models to keep them)."
fi
echo

if [ $DRY_RUN -eq 1 ]; then
  echo "Dry run — nothing was deleted."
  exit 0
fi

if [ $ASSUME_YES -eq 0 ]; then
  read -r -p "Continue? [y/N] " reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Cancelled."; exit 0 ;;
  esac
fi

if pgrep -x Transcriber >/dev/null 2>&1; then
  echo "Quitting Transcriber…"
  osascript -e 'tell application "Transcriber" to quit' >/dev/null 2>&1
  for _ in 1 2 3 4 5; do
    pgrep -x Transcriber >/dev/null 2>&1 || break
    sleep 1
  done
  pgrep -x Transcriber >/dev/null 2>&1 && pkill -x Transcriber
fi

for t in "${TARGETS[@]}"; do
  echo "Removing $t"
  rm -rf "$t" || { echo "  failed — try again with: sudo rm -rf \"$t\""; }
done

echo
echo "Done. Transcriber has been removed."
[ $KEEP_APP -eq 1 ] && echo "The app itself was kept — launch it to run setup again."
[ $KEEP_APP -eq 0 ] && echo "To reinstall, open the .dmg and drag Transcriber to Applications."
