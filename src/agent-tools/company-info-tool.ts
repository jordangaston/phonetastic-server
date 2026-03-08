import { llm } from '@livekit/agents';
import { container } from '../config/container.js';
import type { EmbeddingService } from '../services/embedding-service.js';
import type { FaqRepository } from '../repositories/faq-repository.js';

/**
 * Creates a tool that searches company FAQs using vector similarity.
 *
 * @precondition The company must have FAQs with embeddings populated.
 * @postcondition Returns the most relevant FAQ answers for the query.
 * @param companyId - The company whose FAQs to search.
 * @returns An LLM tool the agent can invoke to answer company questions.
 */
export function createCompanyInfoTool(companyId: number) {
  return llm.tool({
    description:
      'Searches the company knowledge base (FAQs, products, services) ' +
      'to answer questions about the business. Use this tool whenever ' +
      'the caller asks about the company.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The question or topic to search for.',
        },
      },
      required: ['query'],
    },
    execute: async (params: { query: string }) => {
      try {
        const embeddingService = container.resolve<EmbeddingService>('EmbeddingService');
        const faqRepo = container.resolve<FaqRepository>('FaqRepository');

        const [queryEmbedding] = await embeddingService.embed([params.query]);
        const results = await faqRepo.searchByEmbedding(companyId, queryEmbedding, 3);

        if (results.length === 0) {
          return { found: false, message: 'No relevant information found.' };
        }

        return {
          found: true,
          results: results.map((r) => ({
            question: r.question,
            answer: r.answer,
            relevance: Math.round(r.similarity * 100) / 100,
          })),
        };
      } catch (err: any) {
        return { error: err.message };
      }
    },
  });
}
