#!/usr/bin/env node
// Pre-release integration test: fresh install from blank state
// Creates an isolated temp directory, runs the full setup flow (venv + pip install),
// then transcribes a test audio file to verify the pipeline end-to-end.
//
// Usage: npm run test:blank-install
// Runtime: ~3-10 minutes (pip install + possible model download)

const path = require('path');
const fs = require('fs');
const os = require('os');

// Create isolated temp directory BEFORE requiring source modules
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcriber-blank-'));
process.env.TRANSCRIBER_DATA_DIR = tmpDir;

const setup = require('../src/setup');
const config = require('../src/config');
const database = require('../src/database');
const transcriber = require('../src/transcriber');

const TEST_AUDIO = path.join(__dirname, 'test_audio', 'test-message-1.mp3');

async function run() {
  console.log('Data dir:', tmpDir);

  // 1. Verify blank state
  if (setup.isSetupComplete()) {
    throw new Error('Expected blank state but isSetupComplete() returned true');
  }
  console.log('OK: blank state confirmed');

  // 2. Run full setup (venv creation, pip install mlx-whisper + ffmpeg)
  console.log('Running setup (this takes several minutes)...');
  await setup.runSetup((msg) => console.log('  ', msg));
  console.log('OK: setup completed');

  // 3. Verify setup artifacts
  if (!setup.isSetupComplete()) {
    throw new Error('Setup finished but mlx_whisper binary not found');
  }
  console.log('OK: mlx_whisper binary exists at', setup.getVenvBinPath());

  // 4. Run a transcription
  if (!fs.existsSync(TEST_AUDIO)) {
    throw new Error('Test audio not found: ' + TEST_AUDIO);
  }
  console.log('Running transcription on', path.basename(TEST_AUDIO), '...');

  config.init(setup.getAppDataPath());
  const dbPath = path.join(setup.getAppDataPath(), 'transcriptions.db');
  await database.getDb(dbPath);

  const cfg = config.load();
  const stat = fs.statSync(TEST_AUDIO);
  const id = Number(await database.insertTranscription(dbPath, {
    filePath: TEST_AUDIO,
    fileName: path.basename(TEST_AUDIO),
    fileSize: stat.size,
    format: path.extname(TEST_AUDIO).slice(1).toUpperCase(),
  }));

  const fullText = await new Promise((resolve, reject) => {
    transcriber.startTranscription(id, TEST_AUDIO, cfg.command, {
      onSegment() { process.stdout.write('.'); },
      onLog() {},
      onError(msg) { console.error('\nERROR:', msg); },
      onComplete(text, status) {
        if (status && status !== 'completed') reject(new Error('Transcription status: ' + status));
        else resolve(text);
      },
    });
  });
  console.log();

  // 5. Verify result
  const row = await database.getTranscription(dbPath, id);
  if (!row) throw new Error('Transcription not found in database');
  if (!fullText || fullText.length < 10) throw new Error('Transcription text too short: ' + fullText);
  console.log('OK: transcription text length =', fullText.length);
  console.log('OK: preview =', fullText.slice(0, 120));

  database.close();
  console.log('\nPASS: blank install test passed');
}

run()
  .then(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nFAIL:', err.message);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    process.exit(1);
  });
