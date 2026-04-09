const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  checkMlxWhisper: () => ipcRenderer.invoke('check-mlx-whisper'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  getFileMetadata: (filePath) => ipcRenderer.invoke('get-file-metadata', filePath),
  startTranscription: (filePath, metadata) =>
    ipcRenderer.invoke('start-transcription', filePath, metadata),
  cancelTranscription: (id) => ipcRenderer.invoke('cancel-transcription', id),
  getActiveCount: () => ipcRenderer.invoke('get-active-count'),
  getTranscriptions: () => ipcRenderer.invoke('get-transcriptions'),
  getTranscription: (id) => ipcRenderer.invoke('get-transcription', id),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (settings) => ipcRenderer.invoke('save-config', settings),
  deleteTranscription: (id) => ipcRenderer.invoke('delete-transcription', id),
  deleteAllTranscriptions: () => ipcRenderer.invoke('delete-all-transcriptions'),
  toggleWatch: (enabled) => ipcRenderer.invoke('toggle-watch', enabled),
  getWatchState: () => ipcRenderer.invoke('get-watch-state'),
  checkSetupComplete: () => ipcRenderer.invoke('check-setup-complete'),
  runSetup: () => ipcRenderer.invoke('run-setup'),
  onSetupProgress: (callback) => {
    ipcRenderer.on('setup-progress', (_event, message) => callback(message));
  },

  onTranscriptionSegment: (callback) => {
    ipcRenderer.on('transcription-segment', (_event, id, text) => callback(id, text));
  },
  onTranscriptionLog: (callback) => {
    ipcRenderer.on('transcription-log', (_event, id, level, message) =>
      callback(id, level, message)
    );
  },
  onTranscriptionComplete: (callback) => {
    ipcRenderer.on('transcription-complete', (_event, id, status) => callback(id, status));
  },
  onWatchTranscriptionStarted: (callback) => {
    ipcRenderer.on('watch-transcription-started', (_event, id, fileName, metadata) =>
      callback(id, fileName, metadata)
    );
  },
});
