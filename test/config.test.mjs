import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const config = require('../src/config');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_DIR = path.join(__dirname, 'test_config');

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true }); } catch {}
}

describe('config', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    config.init(TEST_DIR);
  });

  afterEach(() => { cleanup(); });

  it('returns defaults when no config file exists', () => {
    const cfg = config.load();
    expect(cfg.command).toContain('mlx_whisper');
    expect(cfg.maxParallelRuns).toBe(3);
  });

  it('saves and loads settings', () => {
    config.save({ maxParallelRuns: 5 });
    const cfg = config.load();
    expect(cfg.maxParallelRuns).toBe(5);
    expect(cfg.command).toContain('mlx_whisper');
  });

  it('merges partial updates', () => {
    config.save({ command: 'custom_command [INPUT_FILE]' });
    config.save({ maxParallelRuns: 7 });
    const cfg = config.load();
    expect(cfg.command).toBe('custom_command [INPUT_FILE]');
    expect(cfg.maxParallelRuns).toBe(7);
  });

  it('persists to disk as JSON', () => {
    config.save({ maxParallelRuns: 2 });
    const raw = JSON.parse(fs.readFileSync(path.join(TEST_DIR, 'config.json'), 'utf-8'));
    expect(raw.maxParallelRuns).toBe(2);
  });

  it('defaults to the turbo model', () => {
    const cfg = config.load();
    expect(cfg.model).toBe('turbo');
    expect(cfg.command).toContain('mlx-community/whisper-large-v3-turbo');
  });

  it('migrates retired models to their replacement', () => {
    config.save({ model: 'medium', command: 'mlx_whisper --model mlx-community/whisper-medium-mlx --verbose True [INPUT_FILE]' });
    const cfg = config.load();
    expect(cfg.model).toBe('turbo');
    expect(cfg.command).toBe('mlx_whisper --model mlx-community/whisper-large-v3-turbo --verbose True [INPUT_FILE]');

    config.save({ model: 'tiny', command: 'mlx_whisper --model mlx-community/whisper-tiny-mlx --verbose True [INPUT_FILE]' });
    expect(config.load().model).toBe('small');
  });

  it('leaves a still-supported model choice untouched', () => {
    config.save({ model: 'small', command: 'mlx_whisper --model mlx-community/whisper-small-mlx --verbose True [INPUT_FILE]' });
    const cfg = config.load();
    expect(cfg.model).toBe('small');
    expect(cfg.command).toContain('whisper-small-mlx');
  });

  it('exposes a model catalog whose ids match the picker keys', () => {
    expect(Object.keys(config.MODELS)).toEqual(['small', 'turbo', 'large']);
    for (const info of Object.values(config.MODELS)) {
      expect(info.id).toMatch(/^mlx-community\//);
      expect(info.label).toBeTruthy();
    }
  });

  describe('parseModelId', () => {
    it('extracts the model repo id from a command', () => {
      expect(config.parseModelId('mlx_whisper --model mlx-community/whisper-small-mlx --verbose True [INPUT_FILE]'))
        .toBe('mlx-community/whisper-small-mlx');
    });

    it('returns null when the command has no --model argument', () => {
      expect(config.parseModelId('mlx_whisper --verbose True [INPUT_FILE]')).toBeNull();
    });
  });

  describe('validateCommand', () => {
    it('accepts the default command and marks its model as known', () => {
      const result = config.validateCommand(config.DEFAULTS.command);
      expect(result).toEqual({
        ok: true,
        modelId: 'mlx-community/whisper-large-v3-turbo',
        known: true,
      });
    });

    it('rejects a command without the [INPUT_FILE] placeholder', () => {
      const result = config.validateCommand('mlx_whisper --model mlx-community/whisper-small-mlx');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('[INPUT_FILE]');
    });

    it('rejects a command without a --model argument', () => {
      const result = config.validateCommand('mlx_whisper --verbose True [INPUT_FILE]');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('--model');
    });

    it('accepts a model outside the catalog but marks it unknown', () => {
      const result = config.validateCommand('mlx_whisper --model mlx-community/whisper-high-mlx [INPUT_FILE]');
      expect(result).toEqual({
        ok: true,
        modelId: 'mlx-community/whisper-high-mlx',
        known: false,
      });
    });
  });
});
