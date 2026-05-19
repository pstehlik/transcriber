const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const database = require('./database');
const config = require('./config');
const transcriber = require('./transcriber');
const watcher = require('./watcher');
const setup = require('./setup');
const whatsapp = require('./whatsapp');

let mainWindow = null;

function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  }
}

const appDataPath = setup.getAppDataPath();
const dbPath = path.join(appDataPath, 'transcriptions.db');

function ensureAppData() {
  if (!fs.existsSync(appDataPath)) {
    fs.mkdirSync(appDataPath, { recursive: true });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 900,
    minHeight: 700,
    title: 'Transcriber',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

const pendingWatchFiles = [];

async function getFileMetadata(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).slice(1).toUpperCase();
    const fileName = path.basename(filePath);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);

    let duration = null;
    try {
      const mm = await import('music-metadata');
      const metadata = await mm.parseFile(filePath);
      if (metadata.format.duration) {
        const secs = Math.round(metadata.format.duration);
        const mins = Math.floor(secs / 60);
        const rem = secs % 60;
        duration = `${mins}:${String(rem).padStart(2, '0')}`;
      }
    } catch {
      // Duration not available
    }

    return { filePath, fileName, fileSize: stat.size, sizeMB, duration, format: ext };
  } catch (err) {
    return { error: err.message };
  }
}

function startTranscriptionRun(id, filePath, command) {
  transcriber.startTranscription(id, filePath, command, {
    onSegment(segmentText) {
      database.appendText(dbPath, id, (segmentText ? ' ' : '') + segmentText);
      sendToRenderer('transcription-segment', id, segmentText);
    },
    onLog(level, message) {
      sendToRenderer('transcription-log', id, level, message);
    },
    onError(message) {
      sendToRenderer('transcription-log', id, 'error', message);
    },
    onComplete(fullText, status) {
      const finalStatus = status || 'completed';
      database.completeTranscription(dbPath, id, finalStatus);
      sendToRenderer('transcription-complete', id, finalStatus);
      processPendingWatchFiles();
    },
  });
}

function startWhatsApp() {
  whatsapp.connect({
    async onQR(qr) {
      try {
        const QRCode = require('qrcode');
        const dataUrl = await QRCode.toDataURL(qr, { width: 200, margin: 1 });
        sendToRenderer('whatsapp-qr', dataUrl);
      } catch {
        sendToRenderer('whatsapp-qr', null);
      }
    },
    onStatusChange(status) {
      sendToRenderer('whatsapp-status-change', status);
    },
    async onVoiceMessage({ filePath, fileName, senderName }) {
      try {
        const exists = await database.hasTranscriptionForPath(dbPath, filePath);
        if (exists) return;

        const cfg = config.load();
        if (transcriber.getActiveCount() >= cfg.maxParallelRuns) {
          if (!pendingWatchFiles.includes(filePath)) {
            pendingWatchFiles.push(filePath);
          }
          return;
        }

        const metadata = await getFileMetadata(filePath);
        if (metadata.error) return;

        const displayName = `${senderName}: ${fileName}`;
        const id = await database.insertTranscription(dbPath, {
          filePath,
          fileName: displayName,
          fileSize: metadata.fileSize,
          duration: metadata.duration,
          format: metadata.format,
        });

        focusMainWindow();
        sendToRenderer('watch-transcription-started', Number(id), displayName, metadata);
        startTranscriptionRun(Number(id), filePath, cfg.command);
      } catch (err) {
        console.error('WhatsApp transcription error:', err);
      }
    },
  });
}

function startWatcher() {
  watcher.start(async (filePath) => {
    try {
      await handleWatchedFile(filePath);
    } catch (err) {
      console.error('Watcher error for', filePath, err);
    }
  });
}

async function handleWatchedFile(filePath) {
  const exists = await database.hasTranscriptionForPath(dbPath, filePath);
  if (exists) return;

  const cfg = config.load();
  if (transcriber.getActiveCount() >= cfg.maxParallelRuns) {
    if (!pendingWatchFiles.includes(filePath)) {
      pendingWatchFiles.push(filePath);
    }
    return;
  }

  const metadata = await getFileMetadata(filePath);
  if (metadata.error) return;

  const id = await database.insertTranscription(dbPath, {
    filePath,
    fileName: metadata.fileName,
    fileSize: metadata.fileSize,
    duration: metadata.duration,
    format: metadata.format,
  });

  focusMainWindow();
  sendToRenderer('watch-transcription-started', Number(id), metadata.fileName, metadata);
  startTranscriptionRun(Number(id), filePath, cfg.command);
}

function processPendingWatchFiles() {
  if (!watcher.isRunning() || pendingWatchFiles.length === 0) return;
  const filePath = pendingWatchFiles.shift();
  handleWatchedFile(filePath);
}

function setupIPC() {
  ipcMain.handle('check-mlx-whisper', async () => {
    return transcriber.checkInstalled();
  });

  ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio Files',
          extensions: [
            'mp3', 'wav', 'flac', 'm4a', 'ogg', 'opus', 'wma', 'aac',
            'aiff', 'webm', 'mp4',
          ],
        },
      ],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('get-file-metadata', async (_event, filePath) => {
    return getFileMetadata(filePath);
  });

  ipcMain.handle('start-transcription', async (_event, filePath, metadata) => {
    const cfg = config.load();
    if (transcriber.getActiveCount() >= cfg.maxParallelRuns) {
      return { error: 'Max parallel runs reached' };
    }

    const id = await database.insertTranscription(dbPath, {
      filePath,
      fileName: metadata.fileName,
      fileSize: metadata.fileSize,
      duration: metadata.duration,
      format: metadata.format,
    });

    startTranscriptionRun(Number(id), filePath, cfg.command);

    return { id: Number(id) };
  });

  ipcMain.handle('cancel-transcription', async (_event, id) => {
    return transcriber.cancelTranscription(id);
  });

  ipcMain.handle('get-active-count', async () => {
    return transcriber.getActiveCount();
  });

  ipcMain.handle('get-transcriptions', async () => {
    return database.getAllTranscriptions(dbPath);
  });

  ipcMain.handle('get-transcription', async (_event, id) => {
    return database.getTranscription(dbPath, id);
  });

  ipcMain.handle('get-config', async () => {
    return config.load();
  });

  ipcMain.handle('save-config', async (_event, settings) => {
    return config.save(settings);
  });

  ipcMain.handle('toggle-watch', async (_event, enabled) => {
    config.save({ watchFolders: enabled });
    if (enabled) {
      startWatcher();
    } else {
      watcher.stop();
    }
    return enabled;
  });

  ipcMain.handle('get-watch-state', async () => {
    return watcher.isRunning();
  });

  ipcMain.handle('delete-transcription', async (_event, id) => {
    return database.deleteTranscription(dbPath, id);
  });

  ipcMain.handle('delete-all-transcriptions', async () => {
    return database.deleteAllTranscriptions(dbPath);
  });

  ipcMain.handle('whatsapp-connect', async () => {
    startWhatsApp();
    return true;
  });

  ipcMain.handle('whatsapp-disconnect', async () => {
    whatsapp.disconnect();
    return true;
  });

  ipcMain.handle('whatsapp-logout', async () => {
    whatsapp.logout();
    return true;
  });

  ipcMain.handle('whatsapp-status', async () => {
    return whatsapp.getStatus();
  });

  ipcMain.handle('check-setup-complete', () => {
    return setup.isSetupComplete();
  });

  ipcMain.handle('check-model-downloaded', async (_event, modelId) => {
    return setup.isModelDownloaded(modelId);
  });

  ipcMain.handle('download-model', async (_event, modelId) => {
    try {
      await setup.downloadModel(modelId, (message) => {
        sendToRenderer('model-download-progress', message);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('run-setup', async () => {
    try {
      const cfg = config.load();
      const modelMatch = cfg.command.match(/--model\s+(\S+)/);
      const modelName = modelMatch ? modelMatch[1] : null;
      await setup.runSetup((message) => {
        sendToRenderer('setup-progress', message);
      }, modelName);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

app.whenReady().then(async () => {
  ensureAppData();
  config.init(appDataPath);
  await database.getDb(dbPath);
  setupIPC();
  createWindow();

  const cfg = config.load();
  if (cfg.watchFolders) {
    startWatcher();
  }

  if (whatsapp.isConfigured()) {
    startWhatsApp();
  }
});

app.on('window-all-closed', () => {
  whatsapp.disconnect();
  watcher.stop();
  database.close();
  app.quit();
});
