const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const setup = require('./setup');

const activeRuns = new Map();

function checkInstalled() {
  const venvMlx = path.join(setup.getVenvBinPath(), 'mlx_whisper');
  if (fs.existsSync(venvMlx)) {
    return Promise.resolve({ installed: true, path: venvMlx });
  }
  return new Promise((resolve) => {
    execFile('which', ['mlx_whisper'], (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve({
          installed: false,
          message:
            'mlx_whisper not found. Install it with: pip install mlx-whisper\n' +
            'See: https://github.com/ml-explore/mlx-examples/tree/main/whisper',
        });
      } else {
        resolve({ installed: true, path: stdout.trim() });
      }
    });
  });
}

function startTranscription(id, filePath, command, callbacks) {
  const { onSegment, onLog, onError, onComplete } = callbacks;

  const parts = parseCommand(command, filePath);
  const cmd = parts[0];
  const args = parts.slice(1);

  onLog?.('info', `Starting: ${cmd} ${args.join(' ')}`);

  const env = { ...process.env, PYTHONUNBUFFERED: '1' };
  // macOS GUI apps have a minimal PATH; add common tool locations for ffmpeg etc.
  const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
  if (setup.isSetupComplete()) {
    extraPaths.unshift(setup.getVenvBinPath());
  }
  env.PATH = extraPaths.join(':') + ':' + (env.PATH || '');

  const proc = spawn(cmd, args, { env });

  activeRuns.set(id, proc);

  let fullText = '';

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const match = line.match(/\[\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}\.\d{3}\]\s*(.*)/);
      if (match) {
        const segmentText = match[1].trim();
        if (segmentText) {
          fullText += (fullText ? ' ' : '') + segmentText;
          onSegment?.(segmentText, fullText);
        }
      } else {
        onLog?.('info', line.trim());
      }
    }
  });

  proc.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      onLog?.('info', text);
    }
  });

  proc.on('close', (code) => {
    activeRuns.delete(id);
    if (code === 0) {
      onComplete?.(fullText);
    } else if (code === null) {
      onLog?.('warn', 'Transcription cancelled');
      onComplete?.(fullText, 'cancelled');
    } else {
      onError?.(`Process exited with code ${code}`);
      onComplete?.(fullText, 'error');
    }
  });

  proc.on('error', (err) => {
    activeRuns.delete(id);
    onError?.(err.message);
    onComplete?.(fullText, 'error');
  });

  return id;
}

function cancelTranscription(id) {
  const proc = activeRuns.get(id);
  if (proc) {
    proc.kill('SIGTERM');
    activeRuns.delete(id);
    return true;
  }
  return false;
}

function getActiveCount() {
  return activeRuns.size;
}

function parseCommand(command, filePath) {
  // Use a placeholder that won't appear in real commands, split, then replace
  const PLACEHOLDER = '\x00INPUT_FILE\x00';
  const withPlaceholder = command.replace(/\[INPUT_FILE\]/g, PLACEHOLDER);
  const parts = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const ch of withPlaceholder) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);

  // Replace placeholder with the actual file path (preserved as a single token)
  return parts.map((p) => p === PLACEHOLDER ? filePath : p.replaceAll(PLACEHOLDER, filePath));
}

module.exports = {
  checkInstalled,
  startTranscription,
  cancelTranscription,
  getActiveCount,
  parseCommand,
};
