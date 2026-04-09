// E2E smoke test: runs inside Electron to verify the full flow
// Usage: npx electron test/e2e-smoke.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const database = require('../src/database');
const config = require('../src/config');
const transcriber = require('../src/transcriber');

const appDataPath = path.join(process.env.HOME, '.transcriber');
const dbPath = path.join(appDataPath, 'transcriptions.db');
const testAudio = path.join(__dirname, 'test_audio', 'test-message-1.mp3');

async function run() {
  if (!fs.existsSync(appDataPath)) fs.mkdirSync(appDataPath, { recursive: true });
  config.init(appDataPath);
  await database.getDb(dbPath);

  // 1. Check mlx_whisper
  const check = await transcriber.checkInstalled();
  if (!check.installed) {
    console.error('FAIL: mlx_whisper not installed');
    process.exit(1);
  }
  console.log('OK: mlx_whisper found at', check.path);

  // 2. Verify test audio exists
  if (!fs.existsSync(testAudio)) {
    console.error('FAIL: test audio not found at', testAudio);
    process.exit(1);
  }
  console.log('OK: test audio found');

  // 3. Insert and run transcription
  const cfg = config.load();
  const stat = fs.statSync(testAudio);
  const id = Number(await database.insertTranscription(dbPath, {
    filePath: testAudio,
    fileName: path.basename(testAudio),
    fileSize: stat.size,
    format: 'M4A',
  }));
  console.log('OK: inserted transcription id', id);

  await new Promise((resolve) => {
    transcriber.startTranscription(id, testAudio, cfg.command, {
      onSegment(text) {
        database.appendText(dbPath, id, ' ' + text);
        process.stdout.write('.');
      },
      onLog() {},
      onError(msg) { console.error('\nERROR:', msg); },
      onComplete(fullText, status) {
        database.completeTranscription(dbPath, id, status || 'completed');
        resolve();
      },
    });
  });

  // 4. Verify persisted result
  const row = await database.getTranscription(dbPath, id);
  console.log();
  if (!row) {
    console.error('FAIL: transcription not found in database');
    process.exit(1);
  }
  if (row.status !== 'completed') {
    console.error('FAIL: status is', row.status, 'expected completed');
    process.exit(1);
  }
  if (!row.text || row.text.length < 10) {
    console.error('FAIL: text too short:', row.text);
    process.exit(1);
  }
  console.log('OK: status =', row.status);
  console.log('OK: text length =', row.text.length);
  console.log('OK: text preview =', row.text.slice(0, 120));

  // 5. Verify window loads
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  const title = win.getTitle();
  console.log('OK: window loaded, title =', title);

  database.close();
  console.log('\nPASS: all e2e checks passed');
  process.exit(0);
}

app.whenReady().then(run).catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
