import { env } from '../config/env.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

/**
 * Response shape from the OpenAI embeddings API.
 */
interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

/**
 * Service for generating vector embeddings via the OpenAI API.
 */
export interface EmbeddingService {
  /**
   * Generates embeddings for one or more text inputs.
   *
   * @precondition `texts` must be non-empty and each string must be non-empty.
   * @postcondition Returns one embedding per input text, in the same order.
   * @param texts - The strings to embed.
   * @returns An array of 1536-dimension vectors, one per input text.
   * @throws If the OpenAI API call fails or returns an unexpected shape.
   */
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * OpenAI-backed implementation of {@link EmbeddingService}.
 */
export class OpenAIEmbeddingService implements EmbeddingService {
  /** @inheritdoc */
  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ input: texts, model: EMBEDDING_MODEL }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI embeddings failed (${res.status}): ${body}`);
    }

    const json = (await res.json()) as EmbeddingResponse;
    return json.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}

/**
 * Stub implementation of {@link EmbeddingService} for tests.
 *
 * Returns deterministic zero-vectors of dimension 1536.
 */
export class StubEmbeddingService implements EmbeddingService {
  /** @inheritdoc */
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array<number>(1536).fill(0));
  }
}
