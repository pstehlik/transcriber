const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const setup = require('./setup');
const config = require('./config');

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

const SEGMENT_RE = /\[(\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}\.\d{3})\]\s*(.*)/;

// Parses one `--verbose True` stdout line into a segment, or null if the line
// is ordinary log output.
//
// `degenerate` marks a segment whose start and end are identical. Whisper can
// fall into a repetition loop at the end of a file: the seek position stops
// advancing and it re-decodes the same instant over and over, emitting dozens
// of copies of the last phrase (e.g. 79x "Ciao." on a 94s voice message). A
// zero-duration segment spans no audio, so it cannot be speech. Turbo's 4-layer
// decoder loops far more readily than the deeper models. Suppressing it via
// decoding flags was measured to be worse: --condition-on-previous-text False
// fragments the text and introduces errors, and --word-timestamps True changes
// transcribed words. Dropping the degenerate segments here costs nothing.
function parseSegmentLine(line) {
  const match = line.match(SEGMENT_RE);
  if (!match) return null;
  const [, start, end, text] = match;
  const [mins, secs] = start.split(':');
  return {
    start,
    end,
    startSeconds: Number(mins) * 60 + Number(secs),
    text: text.trim(),
    degenerate: start === end,
  };
}

// How many consecutive segments with identical text to keep. 1 collapses a
// repeated run down to a single copy. Raise to 2 to let genuine doubling
// ("Ciao. Ciao.") through at the cost of leaving more loop output in place.
const MAX_CONSECUTIVE_IDENTICAL = 1;

// Builds a stateful predicate deciding whether a parsed segment is real speech.
// Rejects three kinds of Whisper repetition-loop output:
//   1. zero-duration segments (see parseSegmentLine)
//   2. segments starting at or after the end of the audio — Whisper pads the
//      final 30s window with zeros and can decode into the padding, e.g. a 63s
//      file emitting segments out to 01:21
//   3. consecutive segments repeating text already emitted (see
//      MAX_CONSECUTIVE_IDENTICAL)
// durationSeconds may be null when the audio length is unknown; rule 2 is then
// skipped rather than guessed at.
function createSegmentFilter(durationSeconds) {
  let lastText = null;
  let repeats = 0;
  return function accept(segment) {
    if (segment.degenerate || !segment.text) return false;
    if (durationSeconds != null && segment.startSeconds >= durationSeconds) return false;
    if (segment.text === lastText) {
      repeats++;
      return repeats < MAX_CONSECUTIVE_IDENTICAL;
    }
    lastText = segment.text;
    repeats = 0;
    return true;
  };
}

// mlx_whisper's CLI wraps each file in `try/except Exception`, prints
// "Skipping <file> due to <ErrorType>: <detail>" and still exits 0. Without
// this, a run that transcribed nothing is recorded as completed with an empty
// transcript, and the only clue is a Python traceback in the log.
const SKIP_RE = /^Skipping .+ due to (\w+):\s*(.*)$/;

// Turns that skip line into something the user can act on, or null for ordinary
// log output. A missing model repo is by far the most common cause: Hugging Face
// answers 401 for a repo that does not exist, so the raw log claims an
// authentication problem when the real fault is the model name in Settings.
function describeFailure(line, modelId) {
  const match = line.trim().match(SKIP_RE);
  if (!match) return null;
  const [, errorType, detail] = match;
  if (errorType === 'RepositoryNotFoundError') {
    const name = modelId ? `"${modelId}"` : 'The configured model';
    return `${name} is not a model on Hugging Face, so nothing could be transcribed. ` +
      'Open Settings, pick a model from the list (this rewrites the --model argument), ' +
      'save, and run this file again.';
  }
  return `mlx_whisper could not transcribe this file — ${errorType}: ${detail}`;
}

function startTranscription(id, filePath, command, callbacks, durationSeconds = null) {
  const { onSegment, onLog, onError, onComplete } = callbacks;
  const acceptSegment = createSegmentFilter(durationSeconds);

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
  let droppedSegments = 0;
  let failureReason = null;
  const modelId = config.parseModelId(command);

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const segment = parseSegmentLine(line);
      if (segment) {
        if (!acceptSegment(segment)) {
          droppedSegments++;
          continue;
        }
        fullText += (fullText ? ' ' : '') + segment.text;
        onSegment?.(segment.text, fullText);
      } else {
        onLog?.('info', line.trim());
        const failure = describeFailure(line, modelId);
        if (failure) {
          failureReason = failure;
          onLog?.('error', failure);
        }
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
    if (droppedSegments > 0) {
      onLog?.('warn', `Dropped ${droppedSegments} segment(s) from a model repetition loop (zero-length, repeated, or past end of audio)`);
    }
    if (code === 0 && failureReason) {
      // mlx_whisper swallowed the error and exited 0; do not call this a success.
      onError?.(failureReason);
      onComplete?.(fullText, 'error');
    } else if (code === 0) {
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
  describeFailure,
  checkInstalled,
  startTranscription,
  cancelTranscription,
  getActiveCount,
  parseCommand,
  parseSegmentLine,
  createSegmentFilter,
};
