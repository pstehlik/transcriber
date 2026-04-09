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
});
