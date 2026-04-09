import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { matchesPattern, PATTERNS, WATCH_DIRS } = require('../src/watcher');

describe('watcher', () => {
  describe('matchesPattern — Telegram', () => {
    it('matches a standard Telegram voice filename', () => {
      expect(matchesPattern('2026-04-09 13.50.58.ogg')).toBe(true);
    });

    it('matches Telegram with different date/time values', () => {
      expect(matchesPattern('2025-01-01 00.00.00.ogg')).toBe(true);
      expect(matchesPattern('2030-12-31 23.59.59.ogg')).toBe(true);
    });

    it('matches Telegram with macOS duplicate numbering', () => {
      expect(matchesPattern('2026-04-09 13.50.58 (1).ogg')).toBe(true);
      expect(matchesPattern('2026-04-09 13.50.58 (2).ogg')).toBe(true);
      expect(matchesPattern('2026-04-09 13.50.58 (15).ogg')).toBe(true);
    });
  });

  describe('matchesPattern — Signal', () => {
    it('matches a standard Signal voice filename', () => {
      expect(matchesPattern('signal-2026-04-09-07-43-38-033.m4a')).toBe(true);
    });

    it('matches Signal with different date/time values', () => {
      expect(matchesPattern('signal-2025-01-01-00-00-00-000.m4a')).toBe(true);
      expect(matchesPattern('signal-2030-12-31-23-59-59-999.m4a')).toBe(true);
    });

    it('matches Signal with macOS duplicate numbering', () => {
      expect(matchesPattern('signal-2026-04-09-07-43-38-033 (1).m4a')).toBe(true);
      expect(matchesPattern('signal-2026-04-09-07-43-38-033 (2).m4a')).toBe(true);
      expect(matchesPattern('signal-2026-04-09-07-43-38-033 (10).m4a')).toBe(true);
    });
  });

  describe('matchesPattern — WhatsApp', () => {
    it('matches a standard WhatsApp voice filename', () => {
      expect(matchesPattern('WhatsApp Audio 2026-04-08 at 12.42.51.opus')).toBe(true);
    });

    it('matches WhatsApp with different date/time values', () => {
      expect(matchesPattern('WhatsApp Audio 2025-01-01 at 00.00.00.opus')).toBe(true);
      expect(matchesPattern('WhatsApp Audio 2030-12-31 at 23.59.59.opus')).toBe(true);
    });

    it('matches WhatsApp with macOS duplicate numbering', () => {
      expect(matchesPattern('WhatsApp Audio 2026-04-08 at 12.42.51 (1).opus')).toBe(true);
      expect(matchesPattern('WhatsApp Audio 2026-04-08 at 12.42.51 (2).opus')).toBe(true);
      expect(matchesPattern('WhatsApp Audio 2026-04-08 at 12.42.51 (99).opus')).toBe(true);
    });
  });

  describe('matchesPattern — non-matching filenames', () => {
    it('rejects random unrelated filenames', () => {
      expect(matchesPattern('readme.txt')).toBe(false);
      expect(matchesPattern('photo.jpg')).toBe(false);
      expect(matchesPattern('song.mp3')).toBe(false);
      expect(matchesPattern('')).toBe(false);
    });

    it('rejects Telegram-like but wrong extension', () => {
      expect(matchesPattern('2026-04-09 13.50.58.mp3')).toBe(false);
      expect(matchesPattern('2026-04-09 13.50.58.m4a')).toBe(false);
    });

    it('rejects Telegram-like but malformed date/time', () => {
      expect(matchesPattern('2026-4-09 13.50.58.ogg')).toBe(false);
      expect(matchesPattern('2026-04-09 3.50.58.ogg')).toBe(false);
      expect(matchesPattern('26-04-09 13.50.58.ogg')).toBe(false);
    });

    it('rejects Signal-like but wrong prefix or extension', () => {
      expect(matchesPattern('Signal-2026-04-09-07-43-38-033.m4a')).toBe(false);
      expect(matchesPattern('signal-2026-04-09-07-43-38-033.ogg')).toBe(false);
    });

    it('rejects Signal-like but missing milliseconds', () => {
      expect(matchesPattern('signal-2026-04-09-07-43-38.m4a')).toBe(false);
    });

    it('rejects WhatsApp-like but wrong case or extension', () => {
      expect(matchesPattern('whatsapp Audio 2026-04-08 at 12.42.51.opus')).toBe(false);
      expect(matchesPattern('WhatsApp Audio 2026-04-08 at 12.42.51.ogg')).toBe(false);
    });

    it('rejects WhatsApp-like but missing "at" keyword', () => {
      expect(matchesPattern('WhatsApp Audio 2026-04-08 12.42.51.opus')).toBe(false);
    });

    it('rejects filenames with path prefixes', () => {
      expect(matchesPattern('/Users/me/Downloads/2026-04-09 13.50.58.ogg')).toBe(false);
      expect(matchesPattern('Downloads/signal-2026-04-09-07-43-38-033.m4a')).toBe(false);
    });

    it('rejects duplicate numbering without space before parenthesis', () => {
      expect(matchesPattern('2026-04-09 13.50.58(1).ogg')).toBe(false);
      expect(matchesPattern('signal-2026-04-09-07-43-38-033(1).m4a')).toBe(false);
      expect(matchesPattern('WhatsApp Audio 2026-04-08 at 12.42.51(1).opus')).toBe(false);
    });
  });

  describe('exports', () => {
    it('exports PATTERNS as an array of regexes', () => {
      expect(Array.isArray(PATTERNS)).toBe(true);
      expect(PATTERNS.length).toBe(3);
      PATTERNS.forEach((p) => expect(p).toBeInstanceOf(RegExp));
    });

    it('exports WATCH_DIRS as an array of directory paths', () => {
      expect(Array.isArray(WATCH_DIRS)).toBe(true);
      expect(WATCH_DIRS.length).toBe(2);
      expect(WATCH_DIRS.some((d) => d.endsWith('Downloads'))).toBe(true);
      expect(WATCH_DIRS.some((d) => d.endsWith('Documents'))).toBe(true);
    });
  });
});
