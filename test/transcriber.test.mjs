import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { parseCommand, checkInstalled, getActiveCount, parseSegmentLine, createSegmentFilter } = require('../src/transcriber');
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

  describe('parseSegmentLine', () => {
    it('parses a normal segment into start, end and text', () => {
      const seg = parseSegmentLine('[00:00.000 --> 00:09.360]  Mein Lieber, es ist untergegangen.');
      expect(seg).not.toBeNull();
      expect(seg.text).toBe('Mein Lieber, es ist untergegangen.');
      expect(seg.start).toBe('00:00.000');
      expect(seg.end).toBe('00:09.360');
      expect(seg.degenerate).toBe(false);
    });

    it('flags a zero-duration segment as degenerate', () => {
      // mlx_whisper emits these in an end-of-audio repetition loop: the seek
      // position stops advancing and the same span is decoded over and over.
      const seg = parseSegmentLine('[01:34.840 --> 01:34.840]  Ciao.');
      expect(seg).not.toBeNull();
      expect(seg.text).toBe('Ciao.');
      expect(seg.degenerate).toBe(true);
    });

    it('returns null for non-segment output lines', () => {
      expect(parseSegmentLine('Detected language: German')).toBeNull();
      expect(parseSegmentLine('')).toBeNull();
    });

    it('keeps a legitimate short segment that has real duration', () => {
      const seg = parseSegmentLine('[01:32.460 --> 01:33.400]  Ciao, ciao.');
      expect(seg.degenerate).toBe(false);
    });
  });

  describe('createSegmentFilter', () => {
    const seg = (start, end, text) => parseSegmentLine(`[${start} --> ${end}]  ${text}`);

    it('rejects zero-length segments', () => {
      const accept = createSegmentFilter(94);
      expect(accept(seg('01:34.840', '01:34.840', 'Ciao.'))).toBe(false);
    });

    it('rejects segments that start at or after the end of the audio', () => {
      // 63s test file produced segments running to 01:21 -- hallucinated into
      // Whisper's zero-padded final window, where no audio exists.
      const accept = createSegmentFilter(63.05);
      expect(accept(seg('01:11.460', '01:12.460', 'Schuetzende Kleidung.'))).toBe(false);
    });

    it('keeps segments inside the audio', () => {
      const accept = createSegmentFilter(63.05);
      expect(accept(seg('00:10.000', '00:12.000', 'Echte Sprache.'))).toBe(true);
    });

    it('collapses a run of consecutive identical segments to one', () => {
      const accept = createSegmentFilter(120);
      expect(accept(seg('00:10.000', '00:11.000', 'Ciao.'))).toBe(true);
      expect(accept(seg('00:11.000', '00:12.000', 'Ciao.'))).toBe(false);
      expect(accept(seg('00:12.000', '00:13.000', 'Ciao.'))).toBe(false);
    });

    it('resets the repeat counter when the text changes', () => {
      const accept = createSegmentFilter(120);
      accept(seg('00:10.000', '00:11.000', 'Ja.'));
      expect(accept(seg('00:11.000', '00:12.000', 'Ja.'))).toBe(false);
      expect(accept(seg('00:13.000', '00:14.000', 'Nein.'))).toBe(true);
      expect(accept(seg('00:14.000', '00:15.000', 'Ja.'))).toBe(true);
    });

    it('applies no duration rule when the duration is unknown', () => {
      const accept = createSegmentFilter(null);
      expect(accept(seg('09:59.000', '09:59.500', 'Immer noch Sprache.'))).toBe(true);
    });

    it('parses segment start into seconds', () => {
      expect(parseSegmentLine('[01:11.460 --> 01:12.460]  x').startSeconds).toBeCloseTo(71.46, 3);
    });
  });
});
