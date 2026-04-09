import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const database = require('../src/database');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_DB = path.join(__dirname, 'test_transcriptions.db');

function cleanup() {
  database.close();
  try { fs.unlinkSync(TEST_DB); } catch {}
}

describe('database', () => {
  beforeEach(() => { cleanup(); });
  afterEach(() => { cleanup(); });

  it('creates the table on init', async () => {
    const db = await database.getDb(TEST_DB);
    const result = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='transcriptions'"
    );
    expect(result).toHaveLength(1);
  });

  it('inserts a transcription and returns an id', async () => {
    const id = await database.insertTranscription(TEST_DB, {
      filePath: '/tmp/test.m4a',
      fileName: 'test.m4a',
      fileSize: 1024,
      duration: '1:30',
      format: 'M4A',
    });
    expect(id).toBeGreaterThan(0);
  });

  it('retrieves a transcription by id', async () => {
    const id = await database.insertTranscription(TEST_DB, {
      filePath: '/tmp/test.m4a',
      fileName: 'test.m4a',
      fileSize: 2048,
      duration: '2:00',
      format: 'M4A',
    });
    const row = await database.getTranscription(TEST_DB, Number(id));
    expect(row.file_path).toBe('/tmp/test.m4a');
    expect(row.file_name).toBe('test.m4a');
    expect(row.status).toBe('running');
    expect(row.text).toBe('');
  });

  it('appends text to a transcription', async () => {
    const id = await database.insertTranscription(TEST_DB, {
      filePath: '/tmp/test.m4a',
      fileName: 'test.m4a',
    });
    await database.appendText(TEST_DB, Number(id), 'Hello');
    await database.appendText(TEST_DB, Number(id), ' world');
    const row = await database.getTranscription(TEST_DB, Number(id));
    expect(row.text).toBe('Hello world');
  });

  it('completes a transcription', async () => {
    const id = await database.insertTranscription(TEST_DB, {
      filePath: '/tmp/test.m4a',
      fileName: 'test.m4a',
    });
    await database.completeTranscription(TEST_DB, Number(id), 'completed');
    const row = await database.getTranscription(TEST_DB, Number(id));
    expect(row.status).toBe('completed');
    expect(row.completed_at).toBeTruthy();
  });

  it('returns all transcriptions ordered by id desc', async () => {
    await database.insertTranscription(TEST_DB, { filePath: '/a.m4a', fileName: 'a.m4a' });
    await database.insertTranscription(TEST_DB, { filePath: '/b.m4a', fileName: 'b.m4a' });
    await database.insertTranscription(TEST_DB, { filePath: '/c.m4a', fileName: 'c.m4a' });
    const all = await database.getAllTranscriptions(TEST_DB);
    expect(all).toHaveLength(3);
    expect(all[0].file_name).toBe('c.m4a');
  });

  it('handles null optional fields', async () => {
    const id = await database.insertTranscription(TEST_DB, {
      filePath: '/tmp/test.wav',
      fileName: 'test.wav',
    });
    const row = await database.getTranscription(TEST_DB, Number(id));
    expect(row.file_size).toBeNull();
    expect(row.duration).toBeNull();
    expect(row.format).toBeNull();
  });
});
