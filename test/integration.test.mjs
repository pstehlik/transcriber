import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { startTranscription, cancelTranscription } = require('../src/transcriber');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_AUDIO = path.join(__dirname, 'test_audio', 'test-message-1.mp3');
const COMMAND = 'mlx_whisper --model mlx-community/whisper-medium-mlx --output-format txt --verbose True [INPUT_FILE]';

describe('integration: transcription', () => {
  it('transcribes a test audio file and receives segments', async () => {
    const segments = [];
    const logs = [];
    let finalText = '';
    let finalStatus = '';

    await new Promise((resolve) => {
      startTranscription(9999, TEST_AUDIO, COMMAND, {
        onSegment(text, fullText) {
          segments.push(text);
          finalText = fullText;
        },
        onLog(level, msg) {
          logs.push({ level, msg });
        },
        onError(msg) {
          logs.push({ level: 'error', msg });
        },
        onComplete(fullText, status) {
          finalText = fullText;
          finalStatus = status || 'completed';
          resolve();
        },
      });
    });

    expect(finalStatus).toBe('completed');
    expect(finalText.length).toBeGreaterThan(0);
    expect(segments.length).toBeGreaterThan(0);
  }, 120000);

  it('can cancel a running transcription', async () => {
    let completed = false;
    let status = '';

    const promise = new Promise((resolve) => {
      startTranscription(9998, TEST_AUDIO, COMMAND, {
        onSegment() {},
        onLog() {},
        onError() {},
        onComplete(fullText, s) {
          completed = true;
          status = s || 'completed';
          resolve();
        },
      });

      setTimeout(() => { cancelTranscription(9998); }, 500);
    });

    await promise;
    expect(completed).toBe(true);
    expect(status).toBe('cancelled');
  }, 30000);
});
