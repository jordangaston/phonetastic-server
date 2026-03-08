import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIEmbeddingService, StubEmbeddingService } from '../../../src/services/embedding-service.js';

vi.mock('../../../src/config/env.js', () => ({
  env: { OPENAI_API_KEY: 'test-key' },
}));

describe('OpenAIEmbeddingService', () => {
  const service = new OpenAIEmbeddingService();

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns embeddings sorted by index', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        data: [
          { index: 1, embedding: new Array(1536).fill(0.2) },
          { index: 0, embedding: new Array(1536).fill(0.1) },
        ],
      }),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    const result = await service.embed(['hello', 'world']);

    expect(result).toHaveLength(2);
    expect(result[0][0]).toBe(0.1);
    expect(result[1][0]).toBe(0.2);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    );
  });

  it('throws on non-OK response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded',
    } as Response);

    await expect(service.embed(['test'])).rejects.toThrow('OpenAI embeddings failed (429)');
  });
});

describe('StubEmbeddingService', () => {
  it('returns zero vectors of dimension 1536', async () => {
    const service = new StubEmbeddingService();
    const result = await service.embed(['a', 'b']);

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(1536);
    expect(result[0].every((v) => v === 0)).toBe(true);
  });
});
