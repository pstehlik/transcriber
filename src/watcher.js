const fs = require('fs');
const path = require('path');
const os = require('os');

const PATTERNS = [
  // Telegram: 2026-04-09 13.50.58.ogg
  /^\d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}( \(\d+\))?\.ogg$/,
  // Signal: signal-2026-04-09-07-43-38-033.m4a
  /^signal-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\d{3}( \(\d+\))?\.m4a$/,
  // WhatsApp: WhatsApp Audio 2026-04-08 at 12.42.51.opus
  /^WhatsApp Audio \d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2}( \(\d+\))?\.opus$/,
];

const WATCH_DIRS = [
  path.join(os.homedir(), 'Downloads'),
  path.join(os.homedir(), 'Documents'),
];

const knownFiles = new Set();
let fsWatchers = [];
let onFileCallback = null;
let scanTimeout = null;

function matchesPattern(fileName) {
  return PATTERNS.some((p) => p.test(fileName));
}

function waitForStable(filePath, retries = 0) {
  if (retries >= 30) return; // give up after 30s
  try {
    const size1 = fs.statSync(filePath).size;
    setTimeout(() => {
      try {
        const size2 = fs.statSync(filePath).size;
        if (size2 === size1 && size2 > 0) {
          onFileCallback?.(filePath);
        } else {
          waitForStable(filePath, retries + 1);
        }
      } catch {
        // File was deleted
      }
    }, 1000);
  } catch {
    // File doesn't exist
  }
}

function scanDirs() {
  for (const dir of WATCH_DIRS) {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!matchesPattern(file)) continue;
        const fullPath = path.join(dir, file);
        if (knownFiles.has(fullPath)) continue;
        knownFiles.add(fullPath);
        waitForStable(fullPath);
      }
    } catch {
      // directory might not exist
    }
  }
}

function debouncedScan() {
  clearTimeout(scanTimeout);
  scanTimeout = setTimeout(scanDirs, 1500);
}

function start(callback) {
  if (fsWatchers.length > 0) return;
  onFileCallback = callback;

  // Initial scan: mark existing files as known without triggering callback
  for (const dir of WATCH_DIRS) {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (matchesPattern(file)) {
          knownFiles.add(path.join(dir, file));
        }
      }
    } catch {
      // directory might not exist
    }
  }

  // Start fs.watch on each directory
  for (const dir of WATCH_DIRS) {
    try {
      const w = fs.watch(dir, { persistent: false }, () => {
        debouncedScan();
      });
      w.on('error', (err) => { console.error('Watcher error on', dir + ':', err.message); });
      fsWatchers.push(w);
    } catch {
      // directory might not exist
    }
  }
}

function stop() {
  for (const w of fsWatchers) {
    w.close();
  }
  fsWatchers = [];
  clearTimeout(scanTimeout);
  onFileCallback = null;
}

function isRunning() {
  return fsWatchers.length > 0;
}

module.exports = { start, stop, isRunning, matchesPattern, PATTERNS, WATCH_DIRS };
