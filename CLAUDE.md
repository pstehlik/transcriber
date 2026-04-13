# CLAUDE.md

## Project overview

Transcriber is an Electron desktop app for macOS that transcribes audio files locally using MLX Whisper on Apple Silicon. No cloud services, no uploads — files are read from their original path on disk. Text streams into the UI in real-time as segments are decoded.

The app is distributed as a `.dmg` and handles all Python/mlx_whisper/ffmpeg setup automatically on first launch.

## System requirements

- **Apple Silicon** (M1 or later) — MLX does not run on Intel Macs
- **macOS 14 Sonoma or later** — MLX requires macOS SDK 14.0+
- **Xcode Command Line Tools** — provides Python 3 (macOS prompts to install automatically when python3 is first invoked; user just clicks "Install")

## Tech stack

- **Electron 41** (main + renderer process, contextIsolation enabled, hiddenInset title bar)
- **electron-builder** for packaging as signed/notarized macOS DMG
- **sql.js** (pure WASM SQLite) for local persistence — chosen over better-sqlite3 to avoid native module ABI mismatches between system Node and Electron
- **music-metadata** for audio file metadata (duration, format)
- **mlx_whisper** CLI (external Python tool, spawned as subprocess, installed into a managed venv)
- **static-ffmpeg** (pip package) for ffmpeg on machines that don't have it
- **@whiskeysockets/baileys** for WhatsApp Web integration (unofficial multi-device protocol over WebSocket)
- **qrcode** for generating QR code data URLs (used in main process for WhatsApp linking)
- **pino** (required by baileys, set to silent)
- **vitest** for unit/integration testing

## Key architectural decisions

- **CLI subprocess over Python library**: `mlx_whisper` is invoked via `child_process.spawn()` with `--verbose True` to get streaming segment output. The Python library (`mlx_whisper.transcribe()`) returns all segments at once with no streaming API, so the CLI approach is strictly better for real-time text display.
- **stdout line parsing**: Each segment from `--verbose True` looks like `[00:00.000 --> 00:09.360] transcribed text`. The regex `/\[\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}\.\d{3}\]\s*(.*)/` extracts the text portion.
- **No file copying**: The app passes the original file path directly to mlx_whisper. Audio files are never copied or moved.
- **Pure WASM over native addons**: `sql.js` (WASM) over `better-sqlite3` (native C++ addon). Native addons must be compiled against the exact Node ABI version Electron bundles, requiring `@electron/rebuild` and causing conflicts when running tests under system Node. WASM works everywhere without rebuilding.
- **CJS source, ESM tests**: Source files use CommonJS (required by Electron's main process). Test files use `.mjs` extension for vitest ESM compatibility with `createRequire()` to import CJS modules.
- **Database functions are async**: `sql.js` requires an async `initSqlJs()` call to load the WASM binary, so all database module functions are async. The DB is persisted by writing the full buffer to disk after each write operation.
- **File paths with spaces**: The `parseCommand` function uses a null-byte placeholder for `[INPUT_FILE]`, splits the command on whitespace first, then replaces the placeholder with the actual path. This ensures paths like `WhatsApp Audio 2026-04-08 at 12.42.51.opus` are passed as a single argument to the subprocess.
- **Drag-and-drop file paths**: Electron with `contextIsolation: true` does not expose `file.path` on dropped File objects. The preload script uses `webUtils.getPathForFile()` to resolve native paths.
- **Managed Python venv**: `src/setup.js` creates an isolated venv at `~/.transcriber/venv/` and installs mlx-whisper + ffmpeg into it. The venv's `bin/` is prepended to PATH when spawning transcription subprocesses so the managed binaries are found first — without interfering with any system Python or Homebrew install.
- **PATH augmentation for GUI apps**: macOS GUI apps inherit a minimal PATH (no `/opt/homebrew/bin`). Both `setup.js` and `transcriber.js` prepend `/opt/homebrew/bin` and `/usr/local/bin` to the subprocess environment so Homebrew-installed tools (python3, ffmpeg) are found.
- **WhatsApp via Baileys (unofficial protocol)**: `@whiskeysockets/baileys` implements the WhatsApp Web multi-device protocol directly over WebSocket — no headless browser needed. Requires `fetchLatestBaileysVersion()` to get the current protocol version before connecting, otherwise WhatsApp rejects with a 405. Auth credentials are persisted via `useMultiFileAuthState()` at `~/.transcriber/whatsapp-auth/`. Voice messages are downloaded, saved to `~/.transcriber/whatsapp-audio/`, and fed into the same transcription pipeline as the folder watcher.
- **WhatsApp message filtering**: Only processes messages from individual chats (`@s.whatsapp.net`), skipping groups (`@g.us`) and status broadcasts. Only processes `audioMessage` / `pttMessage` types. Only processes incoming messages (not sent by us).
- **Safe IPC sends via `sendToRenderer()`**: All `mainWindow.webContents.send()` calls go through a `sendToRenderer()` helper that checks `mainWindow && !mainWindow.isDestroyed()`. This prevents crashes during app shutdown when Baileys fires connection-close events after the window is already destroyed.

## First-launch setup flow

On first launch the renderer checks `setup.isSetupComplete()` (does `~/.transcriber/venv/bin/mlx_whisper` exist?) and falls back to a `which mlx_whisper` PATH check. If neither succeeds, a setup screen is shown with a welcome message explaining what will be downloaded and a "Start Initialization" button. The user must click the button to begin setup:

1. **Platform check** — Apple Silicon + macOS 14+; clear error if not met
2. **Python 3 check** — if missing, shows message about the Xcode CLT install dialog
3. **Create venv** — `python3 -m venv ~/.transcriber/venv/`
4. **pip install mlx-whisper** — installs MLX, numpy, whisper, and dependencies into the venv
5. **ffmpeg check** — if ffmpeg is not on PATH (including Homebrew locations), installs `static-ffmpeg` via pip and symlinks the binary into `venv/bin/`
6. **Model download** — downloads the default Whisper model (~1.5 GB) via `huggingface_hub.snapshot_download()` so the first transcription starts immediately without a long wait
7. **Done** — transitions to the main app, ready to transcribe

If a user already has mlx_whisper on their system PATH (e.g. installed via pip globally), the setup screen is skipped entirely.

## Commands

```bash
npm start              # Launch the Electron app
npm run build          # Package as signed/notarized macOS DMG (output in dist/; requires .env with signing credentials)
npm test               # Run unit + integration tests (vitest, system Node)
npm run test:e2e       # Run e2e smoke test inside Electron (transcribes audio, verifies DB, loads window)
npm run test:launch    # Verify the app starts without crashing
npm run test:all       # Run all of the above sequentially
npm run test:blank-install  # Pre-release: fresh venv + pip install + transcribe in temp dir (~5 min)
npm run test:dmg            # Pre-release: mount built DMG + launch with isolated data dir
```

### Release testing

Before tagging a release, run the full test suite (`npm run test:all`), then the pre-release tests:

1. `npm run test:blank-install` — creates a temp data dir, runs the full first-launch setup (venv + pip + model download), transcribes a test file, and cleans up. Takes ~5 minutes depending on network speed. Validates the setup flow end-to-end.
2. `npm run build` — build the DMG (requires `.env` with `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD` for signing/notarization).
3. `npm run test:dmg` — mounts the built DMG, launches the app with an isolated data dir, and verifies it doesn't crash.

## Project structure

- `src/main.js` — Electron main process: window creation, IPC handler registration, setup/transcription/WhatsApp orchestration, `sendToRenderer()` safe IPC helper
- `src/preload.js` — contextBridge exposing `window.api` to renderer (includes `webUtils.getPathForFile`, setup IPC, and WhatsApp IPC)
- `src/renderer.js` — All UI logic: setup screen, drag-drop, history selection, streaming text display, config screen, WhatsApp status bar and settings UI
- `src/setup.js` — First-launch setup: platform checks, venv creation, pip install mlx-whisper, ffmpeg install. Reports progress via callbacks. Exports `getAppDataPath()` (reads `TRANSCRIBER_DATA_DIR` env var, defaults to `~/.transcriber/`) used by all modules.
- `src/database.js` — SQLite wrapper using sql.js (WASM); async init, writes full DB buffer to disk on each mutation. Tables: `transcriptions`
- `src/config.js` — JSON config at `~/.transcriber/config.json`, merged with defaults on load
- `src/transcriber.js` — Spawns mlx_whisper subprocesses with venv-augmented PATH, tracks active runs in a Map, handles cancel via SIGTERM, parses stdout segments
- `src/whatsapp.js` — WhatsApp Web client using Baileys: QR code linking, connection lifecycle with auto-reconnect, voice message detection/download, auth persistence
- `src/watcher.js` — Watches ~/Downloads and ~/Documents for voice message files (Telegram .ogg, Signal .m4a, WhatsApp .opus) and auto-transcribes new arrivals
- `src/index.html` + `src/styles.css` — Minimal monochrome UI with setup, main, and config screens
- `build/icon.icns` — macOS app icon (generated from `assets/picsvg_download.svg`)
- `build/entitlements.mac.plist` — macOS entitlements for hardened runtime (JIT, unsigned memory, dyld env vars)
- `assets/` — Source SVG for the app icon
- `test/*.test.mjs` — Unit tests for database, config, transcriber, watcher, whatsapp + integration test (real mlx_whisper)
- `test/e2e-smoke.js` — Full e2e test that runs inside Electron
- `test/test-blank-install.js` — Pre-release: creates temp dir, runs full setup, transcribes, cleans up
- `test/test-dmg.sh` — Pre-release: mounts built DMG, launches with isolated data dir, verifies no crash
- `test/smoke-launch.sh` — Shell script that verifies app startup
- `test/test_audio/` — Test audio files (not committed; provide your own)
- `design/` — Three HTML design mockups (option-a chosen, option-b dark, option-c editorial)

## Data paths

- `~/.transcriber/transcriptions.db` — SQLite database (sql.js binary format)
- `~/.transcriber/config.json` — User settings
- `~/.transcriber/venv/` — Managed Python virtual environment (mlx-whisper, ffmpeg)
- `~/.transcriber/whatsapp-auth/` — Baileys auth credentials (persisted across restarts, cleared on logout)
- `~/.transcriber/whatsapp-audio/` — Downloaded WhatsApp voice messages (permanent, referenced by DB file_path)

## Database schema

```sql
transcriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  duration TEXT,
  format TEXT,
  text TEXT DEFAULT '',
  status TEXT DEFAULT 'running',  -- running | completed | cancelled | error
  created_at TEXT,
  completed_at TEXT
)
```

## Default transcription command

```
mlx_whisper --model mlx-community/whisper-small-mlx --output-format txt --verbose True [INPUT_FILE]
```

`[INPUT_FILE]` is replaced with the actual file path at runtime. The `--verbose True` flag is **required** for streaming output — without it, no text appears until the full transcription completes.

## Building and distributing

```bash
npm run build    # produces dist/Transcriber-<version>-arm64.dmg (~106 MB)
```

The build uses hardened runtime and Apple notarization. Signing credentials (Apple ID, team ID, app-specific password) are loaded from a `.env` file (gitignored) via the build script. The entitlements plist at `build/entitlements.mac.plist` grants JIT, unsigned executable memory, and dyld environment variables — required for Electron and the spawned Python subprocesses.

To distribute: send the DMG file. The recipient drags Transcriber to Applications, opens it, and the setup screen handles everything else automatically.

## Testing notes

- `npm test` runs 55 tests in ~10s: database (7), config (4), transcriber/parseCommand (9), watcher (20), whatsapp (13), integration (2)
- Integration tests require `mlx_whisper` installed and the whisper-small-mlx model downloaded
- `npm run test:e2e` runs inside Electron's Node runtime, verifying no native module issues
- `npm run test:launch` starts the full app and verifies it doesn't crash within 5 seconds
- `npm run test:all` chains all three for a complete verification pass
- The database test creates and cleans up `test/test_transcriptions.db`
- The config test creates and cleans up `test/test_config/`
- Test audio files in `test/test_audio/` are gitignored — provide your own for local testing
