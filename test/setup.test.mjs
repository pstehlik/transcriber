import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const setup = require('../src/setup');

const realFetch = globalThis.fetch;

function stubFetch(impl) {
  globalThis.fetch = impl;
}

describe('setup.modelExistsOnHub', () => {
  afterEach(() => { globalThis.fetch = realFetch; });

  it('reports a model that the Hugging Face API returns 200 for as existing', async () => {
    let requested = null;
    stubFetch(async (url) => { requested = url; return { status: 200 }; });
    const result = await setup.modelExistsOnHub('mlx-community/whisper-large-v3-turbo');
    expect(result).toBe('exists');
    expect(requested).toBe('https://huggingface.co/api/models/mlx-community/whisper-large-v3-turbo');
  });

  it('reports a 401 as missing (Hugging Face answers 401 for repos that do not exist)', async () => {
    stubFetch(async () => ({ status: 401 }));
    expect(await setup.modelExistsOnHub('mlx-community/whisper-high-mlx')).toBe('missing');
  });

  it('reports a 404 as missing', async () => {
    stubFetch(async () => ({ status: 404 }));
    expect(await setup.modelExistsOnHub('mlx-community/nope')).toBe('missing');
  });

  it('reports unknown when the request fails, so offline users are not blocked', async () => {
    stubFetch(async () => { throw new Error('getaddrinfo ENOTFOUND'); });
    expect(await setup.modelExistsOnHub('mlx-community/whisper-small-mlx')).toBe('unknown');
  });

  it('reports unknown for a server-side error', async () => {
    stubFetch(async () => ({ status: 503 }));
    expect(await setup.modelExistsOnHub('mlx-community/whisper-small-mlx')).toBe('unknown');
  });
});
