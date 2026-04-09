# Transcriber

A minimal macOS Electron app for local audio transcription using [MLX Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper) on Apple Silicon.

Drop an audio file (or click "Open File"), and the app transcribes it locally using `mlx_whisper` — no uploads, no cloud, no API keys. Transcription text streams into the UI segment-by-segment as it's processed.

## Prerequisites

- macOS with Apple Silicon (M1/M2/M3/M4)
- Node.js 18+
- [ffmpeg](https://ffmpeg.org/) (required by mlx_whisper for audio decoding)
- Python 3 with `mlx-whisper` installed:

```bash
brew install ffmpeg       # if not already installed
pip install mlx-whisper
```

Verify it works:

```bash
mlx_whisper --help
```

The first transcription will download the model (~1.5 GB for `whisper-medium-mlx`). Subsequent runs use the cached model.

## Setup

```bash
npm install
npm start
```

## Usage

1. **Drag and drop** an audio file onto the left panel, or click **Open File**
2. Transcription starts immediately — text streams into the main text area
3. The **collapsible log panel** shows status and can be expanded for details
4. Click **Stop** to cancel a running transcription
5. Past transcriptions appear in the **History** list at the bottom — click any row to view it
6. Use the **gear icon** to open Settings and configure the transcription command or max parallel runs

File paths with spaces are fully supported.

### Supported audio formats

mp3, wav, flac, m4a, ogg, opus, wma, aac, aiff, webm, mp4

### Settings

- **Transcription Command**: The shell command used for transcription. Use `[INPUT_FILE]` as a placeholder for the audio file path. Default: `mlx_whisper --model mlx-community/whisper-medium-mlx --output-format txt --verbose True [INPUT_FILE]`
- **Max Parallel Runs**: How many transcriptions can run simultaneously (1-10, default 3). When the limit is reached, the drop zone is disabled until a run finishes.

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
└── transcriber.js   # Subprocess management, stdout parsing, cancellation
```

## Tests

```bash
# Unit + integration tests (22 tests, ~4s)
npm test

# E2E smoke test inside Electron (transcribes real audio, verifies DB, loads window)
npm run test:e2e

# Verify the app starts without crashing
npm run test:launch

# Run all of the above
npm run test:all
```

Integration and e2e tests require `mlx_whisper` installed and the model downloaded. Place test audio files in `test/test_audio/`.

## License

[MIT](LICENSE)
