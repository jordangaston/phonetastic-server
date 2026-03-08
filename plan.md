# Vector Search Tool Implementation Plan

## Overview
Add pgvector-based semantic search over FAQ questions using OpenAI `text-embedding-3-small` (1536 dimensions) with cosine similarity ranking. Create a LiveKit agent tool that searches company FAQs by meaning. Modify the company onboarding workflow to generate embeddings when FAQs are persisted.

## Architecture Decisions
- **Embedding model**: OpenAI `text-embedding-3-small` (1536 dims) — cheap, fast, already have API key
- **Similarity metric**: Cosine similarity (`<=>` operator in pgvector)
- **Storage**: pgvector extension in PostgreSQL, `embedding` column on `faqs` table
- **Package**: `pgvector` npm package (provides drizzle-orm integration via `pgvector/drizzle-orm`)

---

## Step 1: pgvector setup script
**File**: `scripts/enable-pgvector.sh`

A simple bash script that:
1. Reads DB connection from `.env` (same pattern as `setup.sh`)
2. Runs `CREATE EXTENSION IF NOT EXISTS vector;` on the database
3. Integrates into `setup.sh` as a new step before migrations

---

## Step 2: Add `pgvector` npm package
```bash
npm install pgvector
```

---

## Step 3: Update FAQ schema with embedding column
**File**: `src/db/schema/faqs.ts`

Add a `vector(1536)` column using the pgvector/drizzle-orm custom type:
```ts
import { vector } from 'pgvector/drizzle-orm';

export const faqs = pgTable('faqs', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull().references(() => companies.id),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }),
});
```

---

## Step 4: Generate and run migration
```bash
npm run db:generate
npm run db:migrate
```

---

## Step 5: Create EmbeddingService
**File**: `src/services/embedding-service.ts`

A thin wrapper around OpenAI's embedding API:
- Method: `embed(texts: string[]): Promise<number[][]>` — batch embed multiple texts
- Uses `text-embedding-3-small` model
- Uses the existing `OPENAI_API_KEY` env var
- Direct `fetch` call to OpenAI API (no extra SDK dependency needed)

Register in DI container as `'EmbeddingService'`.

---

## Step 6: Add vector search to FaqRepository
**File**: `src/repositories/faq-repository.ts`

Add methods:
- `searchByEmbedding(companyId, queryEmbedding, limit)` — cosine similarity search
- `updateEmbeddings(updates: {id, embedding}[])` — batch-update embeddings after insert

---

## Step 7: Create company info search tool
**File**: `src/agent-tools/company-info-tool.ts`

Following the existing tool pattern:
```ts
export function createCompanyInfoTool(companyId: number)
```
- Parameters: `{ query: string }` — the user's question
- Embeds the query, searches FAQs by vector similarity
- Returns top matches with questions and answers

---

## Step 8: Wire tool into agent
**File**: `src/agent.ts`

- Import `createCompanyInfoTool`
- When `callContext` is available, add the tool to the agent

---

## Step 9: Modify onboarding workflow to generate embeddings
**File**: `src/workflows/company-onboarding.ts`

In the `persist` step, after inserting FAQs:
1. Resolve `EmbeddingService`
2. Embed all FAQ questions in a single batch call
3. Update the FAQ rows with their embeddings

---

## Step 10: Register EmbeddingService in container
**File**: `src/config/container.ts`

---

## Step 11: Tests

### Integration: `tests/integration/repositories/faq-repository.test.ts`
- Add tests for `searchByEmbedding` and `updateEmbeddings`

### Unit: `tests/unit/agent-tools/company-info-tool.test.ts`
- Mock `EmbeddingService` and `FaqRepository`
- Verify the tool embeds the query and returns FAQ results

### Unit: `tests/unit/services/embedding-service.test.ts`
- Mock fetch, verify correct API call format

---

## Step 12: Update setup.sh
Add the pgvector enable step before the migration step.
