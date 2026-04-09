import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { parseCommand, checkInstalled, getActiveCount } = require('../src/transcriber');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('transcriber', () => {
  describe('parseCommand', () => {
    it('replaces [INPUT_FILE] with the file path', () => {
      const parts = parseCommand('mlx_whisper --model test [INPUT_FILE]', '/tmp/audio.m4a');
      expect(parts).toEqual(['mlx_whisper', '--model', 'test', '/tmp/audio.m4a']);
    });

    it('handles quoted arguments', () => {
      const parts = parseCommand('cmd --arg "hello world" [INPUT_FILE]', '/tmp/a.m4a');
      expect(parts).toEqual(['cmd', '--arg', 'hello world', '/tmp/a.m4a']);
    });

    it('handles single quotes', () => {
      const parts = parseCommand("cmd --arg 'hello world' [INPUT_FILE]", '/tmp/a.m4a');
      expect(parts).toEqual(['cmd', '--arg', 'hello world', '/tmp/a.m4a']);
    });

    it('handles file paths with spaces as a single token', () => {
      const parts = parseCommand('mlx_whisper [INPUT_FILE]', '/tmp/my audio file.m4a');
      expect(parts).toEqual(['mlx_whisper', '/tmp/my audio file.m4a']);
    });

    it('handles WhatsApp-style filenames with many spaces', () => {
      const parts = parseCommand('mlx_whisper --model test --verbose True [INPUT_FILE]',
        '/Users/me/Downloads/WhatsApp Audio 2026-04-08 at 12.42.51.opus');
      expect(parts).toEqual([
        'mlx_whisper', '--model', 'test', '--verbose', 'True',
        '/Users/me/Downloads/WhatsApp Audio 2026-04-08 at 12.42.51.opus',
      ]);
    });

    it('handles multiple [INPUT_FILE] occurrences', () => {
      const parts = parseCommand('cmd [INPUT_FILE] --out [INPUT_FILE]', '/tmp/a.m4a');
      expect(parts).toEqual(['cmd', '/tmp/a.m4a', '--out', '/tmp/a.m4a']);
    });

    it('handles extra spaces', () => {
      const parts = parseCommand('cmd   --flag   [INPUT_FILE]', '/tmp/a.m4a');
      expect(parts).toEqual(['cmd', '--flag', '/tmp/a.m4a']);
    });
  });

  describe('checkInstalled', () => {
    it('detects mlx_whisper installation', async () => {
      const result = await checkInstalled();
      expect(result).toHaveProperty('installed');
      if (result.installed) {
        expect(result.path).toContain('mlx_whisper');
      } else {
        expect(result.message).toContain('pip install');
      }
    });
  });

  describe('getActiveCount', () => {
    it('returns 0 when no runs are active', () => {
      expect(getActiveCount()).toBe(0);
    });
  });
});
