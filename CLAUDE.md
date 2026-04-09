# CLAUDE.md

## Project overview

Transcriber is an Electron desktop app for macOS that transcribes audio files locally using MLX Whisper on Apple Silicon. No cloud services, no uploads — files are read from their original path on disk. Text streams into the UI in real-time as segments are decoded.

## Tech stack

- **Electron 35** (main + renderer process, contextIsolation enabled, hiddenInset title bar)
- **sql.js** (pure WASM SQLite) for local persistence — chosen over better-sqlite3 to avoid native module ABI mismatches between system Node and Electron
- **music-metadata** for audio file metadata (duration, format)
- **mlx_whisper** CLI (external Python tool, spawned as subprocess)
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

## Commands

```bash
npm start              # Launch the Electron app
npm test               # Run unit + integration tests (vitest, system Node)
npm run test:e2e       # Run e2e smoke test inside Electron (transcribes audio, verifies DB, loads window)
npm run test:launch    # Verify the app starts without crashing
npm run test:all       # Run all of the above sequentially
```

## Project structure

- `src/main.js` — Electron main process: window creation, IPC handler registration, startup mlx_whisper check
- `src/preload.js` — contextBridge exposing `window.api` to renderer (includes `webUtils.getPathForFile`)
- `src/renderer.js` — All UI logic: drag-drop, history selection, streaming text display, config screen
- `src/database.js` — SQLite wrapper using sql.js (WASM); async init, writes full DB buffer to disk on each mutation. Tables: `transcriptions`
- `src/config.js` — JSON config at `~/.transcriber/config.json`, merged with defaults on load
- `src/transcriber.js` — Spawns mlx_whisper subprocesses, tracks active runs in a Map, handles cancel via SIGTERM, parses stdout segments
- `src/index.html` + `src/styles.css` — Minimal monochrome UI (Option A design)
- `test/*.test.mjs` — Unit tests for database, config, transcriber + integration test (real mlx_whisper)
- `test/e2e-smoke.js` — Full e2e test that runs inside Electron
- `test/smoke-launch.sh` — Shell script that verifies app startup
- `test/test_audio/` — Test audio files (not committed; provide your own)
- `design/` — Three HTML design mockups (option-a chosen, option-b dark, option-c editorial)

## Data paths

- `~/.transcriber/transcriptions.db` — SQLite database (sql.js binary format)
- `~/.transcriber/config.json` — User settings

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
mlx_whisper --model mlx-community/whisper-medium-mlx --output-format txt --verbose True [INPUT_FILE]
```

`[INPUT_FILE]` is replaced with the actual file path at runtime. The `--verbose True` flag is **required** for streaming output — without it, no text appears until the full transcription completes.

## Testing notes

- `npm test` runs 22 tests in ~4s: database (7), config (4), transcriber/parseCommand (9), integration (2)
- Integration tests require `mlx_whisper` installed and the whisper-medium-mlx model downloaded
- `npm run test:e2e` runs inside Electron's Node runtime, verifying no native module issues
- `npm run test:launch` starts the full app and verifies it doesn't crash within 5 seconds
- `npm run test:all` chains all three for a complete verification pass
- The database test creates and cleans up `test/test_transcriptions.db`
- The config test creates and cleans up `test/test_config/`
- Test audio files in `test/test_audio/` are gitignored — provide your own for local testing
