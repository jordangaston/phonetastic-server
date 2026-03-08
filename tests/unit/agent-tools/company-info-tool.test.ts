import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEmbeddingService, mockFaqRepo, mockContainer } = vi.hoisted(() => {
  const mockEmbeddingService = {
    embed: vi.fn(),
  };
  const mockFaqRepo = {
    searchByEmbedding: vi.fn(),
  };
  const mockContainer = {
    resolve: vi.fn((token: string) => {
      if (token === 'EmbeddingService') return mockEmbeddingService;
      if (token === 'FaqRepository') return mockFaqRepo;
      return undefined;
    }),
  };
  return { mockEmbeddingService, mockFaqRepo, mockContainer };
});

vi.mock('../../../src/config/container.js', () => ({
  container: mockContainer,
}));

vi.mock('@livekit/agents', () => ({
  llm: {
    tool: vi.fn(({ execute }) => ({ execute })),
  },
}));

import { createCompanyInfoTool } from '../../../src/agent-tools/company-info-tool.js';

describe('createCompanyInfoTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContainer.resolve.mockImplementation((token: string) => {
      if (token === 'EmbeddingService') return mockEmbeddingService;
      if (token === 'FaqRepository') return mockFaqRepo;
      return undefined;
    });
  });

  it('returns matching FAQ results with relevance scores', async () => {
    const fakeEmbedding = new Array(1536).fill(0.1);
    mockEmbeddingService.embed.mockResolvedValue([fakeEmbedding]);
    mockFaqRepo.searchByEmbedding.mockResolvedValue([
      { id: 1, companyId: 5, question: 'What are your hours?', answer: '9am to 5pm', similarity: 0.92 },
    ]);

    const tool = createCompanyInfoTool(5);
    const result = await tool.execute({ query: 'when are you open' });

    expect(result).toEqual({
      found: true,
      results: [{ question: 'What are your hours?', answer: '9am to 5pm', relevance: 0.92 }],
    });
    expect(mockEmbeddingService.embed).toHaveBeenCalledWith(['when are you open']);
    expect(mockFaqRepo.searchByEmbedding).toHaveBeenCalledWith(5, fakeEmbedding, 3);
  });

  it('returns not-found when no FAQs match', async () => {
    mockEmbeddingService.embed.mockResolvedValue([new Array(1536).fill(0)]);
    mockFaqRepo.searchByEmbedding.mockResolvedValue([]);

    const tool = createCompanyInfoTool(5);
    const result = await tool.execute({ query: 'something obscure' });

    expect(result).toEqual({ found: false, message: 'No relevant information found.' });
  });

  it('returns error on embedding service failure', async () => {
    mockEmbeddingService.embed.mockRejectedValue(new Error('OpenAI rate limit'));

    const tool = createCompanyInfoTool(5);
    const result = await tool.execute({ query: 'test' });

    expect(result).toEqual({ error: 'OpenAI rate limit' });
  });
});
