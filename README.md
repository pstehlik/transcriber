# Transcriber

A minimal macOS Electron app for local audio transcription using [MLX Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper) on Apple Silicon.

Drop an audio file (or click "Open Audio File"), and the app transcribes it locally using `mlx_whisper` — no uploads, no cloud, no API keys. Transcription text streams into the UI segment-by-segment as it's processed.

## Requirements

- macOS 14 (Sonoma) or later
- Apple Silicon (M1/M2/M3/M4)
- Node.js 18+ (for development only)

Python, mlx_whisper, and ffmpeg are installed automatically on first launch — no manual setup needed.

## Install

Download the DMG from [Releases](https://github.com/pstehlik/transcriber/releases), open it, and drag Transcriber to Applications.

On first launch, the app creates a Python venv at `~/.transcriber/venv`, installs `mlx-whisper` and `ffmpeg`, and downloads the Whisper model (~1.5 GB). This takes 1–3 minutes.

## Development

```bash
npm install
npm start
```

### Build DMG

```bash
npm run build
```

## Usage

1. **Drag and drop** an audio file onto the left panel, or click **Open Audio File**
2. Transcription starts immediately — text streams into the main text area
3. The **collapsible log panel** shows status and can be expanded for details
4. Click **Stop** to cancel a running transcription
5. Past transcriptions appear in the **History** list at the bottom — click any row to view it
6. Use the **gear icon** to open Settings and configure the transcription command or max parallel runs
7. **Delete** individual history items (trash icon on each row) or all history at once

File paths with spaces are fully supported.

### Folder watcher

Enable "Watch Downloads & Documents for voice messages" in the left panel to auto-transcribe voice messages saved from **WhatsApp**, **Telegram**, or **Signal**. When a matching file appears in your Downloads or Documents folder, transcription starts automatically.

### Supported audio formats

mp3, wav, flac, m4a, ogg, opus, wma, aac, aiff, webm, mp4

### Settings

- **Transcription Command**: The shell command used for transcription. Use `[INPUT_FILE]` as a placeholder for the audio file path.
- **Max Parallel Runs**: How many transcriptions can run simultaneously (1–10, default 3).

## Architecture

The app reads audio files directly from their original location on disk — no copying or uploading. Transcription is done by spawning `mlx_whisper` as a subprocess with `--verbose True`, which outputs each segment to stdout as it's decoded. The app parses these lines in real-time to stream text into the UI.

Transcriptions are persisted in a local SQLite database (via [sql.js](https://github.com/sql-js/sql.js), pure WASM — no native compilation needed) at `~/.transcriber/transcriptions.db`. Settings are stored in `~/.transcriber/config.json`.

```
src/
├── main.js          # Electron main process, IPC handlers, window management
├── preload.js       # contextBridge API exposed to renderer
├── index.html       # UI markup
├── styles.css       # Minimal monochrome design
├── renderer.js      # UI logic, state management, IPC calls
├── database.js      # SQLite operations (sql.js / WASM)
├── config.js        # Settings persistence (~/.transcriber/config.json)
├── transcriber.js   # Subprocess management, stdout parsing, cancellation
├── setup.js         # First-launch setup: venv, mlx_whisper, ffmpeg
└── watcher.js       # Folder watcher for auto-transcribing voice messages
```

## Tests

```bash
# Unit + integration tests (42 tests)
npm test

# E2E smoke test inside Electron
npm run test:e2e

# Verify the app starts without crashing
npm run test:launch

# Run all of the above
npm run test:all
```

Integration and e2e tests require `mlx_whisper` installed and the model downloaded. Place test audio files in `test/test_audio/`.

## License

[MIT](LICENSE)
