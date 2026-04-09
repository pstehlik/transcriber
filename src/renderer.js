(function () {
  'use strict';

  // State
  let selectedRunId = null;
  let currentRunId = null;
  let runTexts = {};       // id -> accumulated text
  let runLogs = {};        // id -> [{ts, level, msg}]
  let runStatuses = {};    // id -> 'running' | 'completed' | 'error' | 'cancelled'
  let maxParallelRuns = 3;

  // Elements
  const screenMain = document.getElementById('screen-main');
  const screenConfig = document.getElementById('screen-config');
  const dropWrapper = document.getElementById('drop-wrapper');
  const dropZone = document.getElementById('drop-zone');
  const btnOpen = document.getElementById('btn-open-file');
  const fileMeta = document.getElementById('file-meta');
  const logPanel = document.getElementById('log-panel');
  const logHeader = document.getElementById('log-header');
  const logEntries = document.getElementById('log-entries');
  const logStatusEl = document.getElementById('log-status');
  const logStatusText = document.getElementById('log-status-text');
  const btnStop = document.getElementById('btn-stop');
  const transcriptionOutput = document.getElementById('transcription-output');
  const btnCopy = document.getElementById('btn-copy');
  const copyLabel = document.getElementById('copy-label');
  const historyList = document.getElementById('history-list');
  const historyEmpty = document.getElementById('history-empty');
  const watchToggle = document.getElementById('watch-toggle-input');
  const startupBanner = document.getElementById('startup-banner');
  const configCommand = document.getElementById('config-command');
  const stepperValue = document.getElementById('stepper-value');
  const btnSave = document.getElementById('btn-save');

  // Screen switching
  document.getElementById('btn-settings').addEventListener('click', async () => {
    const cfg = await window.api.getConfig();
    configCommand.value = cfg.command;
    stepperValue.textContent = cfg.maxParallelRuns;
    maxParallelRuns = cfg.maxParallelRuns;
    screenMain.classList.remove('active');
    screenConfig.classList.add('active');
  });

  document.getElementById('btn-back').addEventListener('click', () => {
    screenConfig.classList.remove('active');
    screenMain.classList.add('active');
  });

  // Log panel toggle
  logHeader.addEventListener('click', () => {
    logPanel.classList.toggle('expanded');
  });

  // Copy button
  let copyTimeout;
  btnCopy.addEventListener('click', () => {
    const text = transcriptionOutput.textContent;
    if (!text || transcriptionOutput.classList.contains('placeholder')) return;
    navigator.clipboard.writeText(text);
    btnCopy.classList.add('copied');
    copyLabel.textContent = 'Copied!';
    clearTimeout(copyTimeout);
    copyTimeout = setTimeout(() => {
      btnCopy.classList.remove('copied');
      copyLabel.textContent = 'Copy to Clipboard';
    }, 1500);
  });

  // Stepper
  let stepperVal = 3;
  document.getElementById('stepper-dec').addEventListener('click', () => {
    if (stepperVal > 1) { stepperVal--; stepperValue.textContent = stepperVal; }
  });
  document.getElementById('stepper-inc').addEventListener('click', () => {
    if (stepperVal < 10) { stepperVal++; stepperValue.textContent = stepperVal; }
  });

  // Save config
  let saveTimeout;
  btnSave.addEventListener('click', async () => {
    await window.api.saveConfig({
      command: configCommand.value,
      maxParallelRuns: stepperVal,
    });
    maxParallelRuns = stepperVal;
    const orig = btnSave.textContent;
    btnSave.textContent = 'Saved!';
    btnSave.style.background = '#34c759';
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      btnSave.textContent = orig;
      btnSave.style.background = '';
    }, 1200);
  });

  // Watch toggle
  watchToggle.addEventListener('change', async () => {
    await window.api.toggleWatch(watchToggle.checked);
  });

  // Watch auto-transcription started
  window.api.onWatchTranscriptionStarted((id, fileName, metadata) => {
    runTexts[id] = '';
    runLogs[id] = [];
    runStatuses[id] = 'running';
    addHistoryRow(id, new Date().toLocaleString(), '', fileName, 'running');
    updateDropZoneState();
  });

  // Drop zone
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) {
      const filePath = window.api.getPathForFile(file);
      if (filePath) handleFile(filePath);
    }
  });

  // Open file button
  btnOpen.addEventListener('click', async () => {
    const filePath = await window.api.openFileDialog();
    if (filePath) handleFile(filePath);
  });

  // Stop button
  btnStop.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentRunId != null) {
      window.api.cancelTranscription(currentRunId);
    }
  });

  // Handle file selection
  async function handleFile(filePath) {
    const activeCount = await window.api.getActiveCount();
    if (activeCount >= maxParallelRuns) return;

    const metadata = await window.api.getFileMetadata(filePath);
    if (metadata.error) {
      addLogEntry(null, 'error', metadata.error);
      return;
    }

    showFileMeta(metadata);

    const result = await window.api.startTranscription(filePath, metadata);
    if (result.error) {
      addLogEntry(null, 'error', result.error);
      return;
    }

    const id = result.id;
    currentRunId = id;
    runTexts[id] = '';
    runLogs[id] = [];
    runStatuses[id] = 'running';

    selectRun(id);
    addHistoryRow(id, new Date().toLocaleString(), '', metadata.fileName, 'running');
    updateDropZoneState();
  }

  function showFileMeta(meta) {
    fileMeta.classList.remove('hidden');
    document.getElementById('meta-file').textContent = meta.fileName;
    document.getElementById('meta-duration').textContent = meta.duration || '—';
    document.getElementById('meta-size').textContent = meta.sizeMB ? `${meta.sizeMB} MB` : '—';
    document.getElementById('meta-format').textContent = meta.format || '—';
  }

  // IPC listeners
  window.api.onTranscriptionSegment((id, text) => {
    if (!runTexts[id]) runTexts[id] = '';
    runTexts[id] += (runTexts[id] ? ' ' : '') + text;
    if (selectedRunId === id) {
      showTranscriptionText(runTexts[id]);
    }
    updateHistoryPreview(id, runTexts[id]);
  });

  window.api.onTranscriptionLog((id, level, message) => {
    if (!runLogs[id]) runLogs[id] = [];
    const entry = { ts: new Date().toLocaleTimeString(), level, msg: message };
    runLogs[id].push(entry);
    if (selectedRunId === id) {
      appendLogEntryDOM(entry);
    }
  });

  window.api.onTranscriptionComplete((id, status) => {
    runStatuses[id] = status;
    if (selectedRunId === id) {
      updateStatusDisplay(status);
    }
    updateHistoryRowStatus(id, status);
    updateDropZoneState();
    if (currentRunId === id) {
      currentRunId = null;
    }
  });

  function selectRun(id) {
    selectedRunId = id;
    // Update log panel
    logEntries.innerHTML = '';
    const logs = runLogs[id] || [];
    for (const entry of logs) {
      appendLogEntryDOM(entry);
    }
    // Update transcription text
    const text = runTexts[id] || '';
    showTranscriptionText(text);
    // Update status
    const status = runStatuses[id] || 'idle';
    updateStatusDisplay(status);
    // Update stop button
    btnStop.disabled = status !== 'running';
    // Highlight history row
    document.querySelectorAll('.history-row').forEach(r => r.classList.remove('selected'));
    const row = document.querySelector(`.history-row[data-id="${id}"]`);
    if (row) row.classList.add('selected');
  }

  function showTranscriptionText(text) {
    if (text) {
      transcriptionOutput.textContent = text;
      transcriptionOutput.classList.remove('placeholder');
      transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;
    } else {
      transcriptionOutput.textContent = 'Transcription will appear here...';
      transcriptionOutput.classList.add('placeholder');
    }
  }

  function updateStatusDisplay(status) {
    logStatusEl.className = 'log-status ' + status;
    const labels = {
      running: 'Transcribing...',
      completed: 'Completed',
      error: 'Error',
      cancelled: 'Cancelled',
      idle: 'Idle',
    };
    logStatusText.textContent = labels[status] || status;
    btnStop.disabled = status !== 'running';
  }

  function addLogEntry(id, level, msg) {
    const entry = { ts: new Date().toLocaleTimeString(), level, msg };
    if (id != null) {
      if (!runLogs[id]) runLogs[id] = [];
      runLogs[id].push(entry);
    }
    if (id == null || selectedRunId === id) {
      appendLogEntryDOM(entry);
    }
  }

  function appendLogEntryDOM(entry) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML =
      `<span class="log-ts">${entry.ts}</span>` +
      `<span class="log-level ${entry.level}">${entry.level.toUpperCase()}</span>` +
      `<span class="log-msg">${escapeHtml(entry.msg)}</span>`;
    logEntries.appendChild(div);
    logEntries.scrollTop = logEntries.scrollHeight;
    // Auto-expand log if error
    if (entry.level === 'error') {
      logPanel.classList.add('expanded');
    }
  }

  // History
  function addHistoryRow(id, timestamp, preview, fileName, status) {
    historyEmpty.style.display = 'none';
    const row = document.createElement('div');
    row.className = 'history-row';
    row.dataset.id = id;
    row.innerHTML =
      `<div class="history-indicator">${status === 'running' ? '<div class="dot-live"></div>' : ''}</div>` +
      `<span class="history-ts">${timestamp}</span>` +
      `<span class="history-preview">${escapeHtml(preview) || 'Transcribing...'}</span>` +
      `<span class="history-file">${escapeHtml(fileName)}</span>`;
    row.addEventListener('click', () => selectRun(id));
    historyList.insertBefore(row, historyList.firstChild);
  }

  function updateHistoryPreview(id, text) {
    const row = document.querySelector(`.history-row[data-id="${id}"]`);
    if (row) {
      const preview = row.querySelector('.history-preview');
      preview.textContent = text.slice(0, 200) || 'Transcribing...';
    }
  }

  function updateHistoryRowStatus(id, status) {
    const row = document.querySelector(`.history-row[data-id="${id}"]`);
    if (row) {
      const indicator = row.querySelector('.history-indicator');
      indicator.innerHTML = '';
    }
  }

  async function updateDropZoneState() {
    const activeCount = await window.api.getActiveCount();
    if (activeCount >= maxParallelRuns) {
      dropWrapper.classList.add('disabled');
      btnOpen.disabled = true;
    } else {
      dropWrapper.classList.remove('disabled');
      btnOpen.disabled = false;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Load history on startup
  async function init() {
    // Check mlx_whisper
    const check = await window.api.checkMlxWhisper();
    if (!check.installed) {
      startupBanner.innerHTML = `<strong>mlx_whisper not found.</strong> ${escapeHtml(check.message)}`;
      startupBanner.classList.add('visible');
    }

    // Load config
    const cfg = await window.api.getConfig();
    maxParallelRuns = cfg.maxParallelRuns;

    // Load watch state
    const watching = await window.api.getWatchState();
    watchToggle.checked = watching;

    // Load history
    const transcriptions = await window.api.getTranscriptions();
    if (transcriptions.length > 0) {
      historyEmpty.style.display = 'none';
      for (const t of transcriptions) {
        runTexts[t.id] = t.text || '';
        runStatuses[t.id] = t.status;
        runLogs[t.id] = [];
        const row = document.createElement('div');
        row.className = 'history-row';
        row.dataset.id = t.id;
        row.innerHTML =
          `<div class="history-indicator"></div>` +
          `<span class="history-ts">${t.created_at}</span>` +
          `<span class="history-preview">${escapeHtml((t.text || '').slice(0, 200)) || '(empty)'}</span>` +
          `<span class="history-file">${escapeHtml(t.file_name)}</span>`;
        row.addEventListener('click', () => selectRun(t.id));
        historyList.appendChild(row);
      }
    }
  }

  init();
})();
