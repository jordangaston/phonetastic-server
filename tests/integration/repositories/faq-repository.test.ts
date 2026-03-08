import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { getTestApp, getTestDb, closeTestApp } from '../../helpers/test-app.js';
import { cleanDatabase } from '../../helpers/db-cleaner.js';
import { container } from 'tsyringe';
import { FaqRepository } from '../../../src/repositories/faq-repository.js';
import { companyFactory } from '../../factories/index.js';

describe('FaqRepository', () => {
  let faqRepo: FaqRepository;

  beforeAll(async () => {
    await getTestApp();
    faqRepo = container.resolve<FaqRepository>('FaqRepository');
  });

  beforeEach(async () => {
    await cleanDatabase(getTestDb());
  });

  afterAll(async () => {
    await closeTestApp();
  });

  describe('createMany', () => {
    it('inserts multiple FAQs and returns them', async () => {
      const company = await companyFactory.create({ name: 'Test Co' });
      const rows = await faqRepo.createMany([
        { companyId: company.id, question: 'Q1', answer: 'A1' },
        { companyId: company.id, question: 'Q2', answer: 'A2' },
      ]);

      expect(rows).toHaveLength(2);
      expect(rows[0].question).toBe('Q1');
      expect(rows[1].answer).toBe('A2');
    });
  });

  describe('findByCompanyId', () => {
    it('returns FAQs belonging to the given company', async () => {
      const company = await companyFactory.create({ name: 'Test Co' });
      await faqRepo.createMany([
        { companyId: company.id, question: 'Q1', answer: 'A1' },
      ]);

      const found = await faqRepo.findByCompanyId(company.id);
      expect(found).toHaveLength(1);
      expect(found[0].question).toBe('Q1');
    });

    it('returns empty array for company with no FAQs', async () => {
      const company = await companyFactory.create({ name: 'Test Co' });
      const found = await faqRepo.findByCompanyId(company.id);
      expect(found).toEqual([]);
    });
  });

  describe('updateEmbeddings', () => {
    it('sets the embedding column for given FAQ rows', async () => {
      const company = await companyFactory.create({ name: 'Test Co' });
      const rows = await faqRepo.createMany([
        { companyId: company.id, question: 'Q1', answer: 'A1' },
      ]);

      const embedding = new Array(1536).fill(0.5);
      await faqRepo.updateEmbeddings([{ id: rows[0].id, embedding }]);

      const found = await faqRepo.findByCompanyId(company.id);
      expect(found[0].embedding).toBeDefined();
      expect(found[0].embedding).toHaveLength(1536);
    });
  });

  describe('searchByEmbedding', () => {
    it('returns FAQs ranked by cosine similarity', async () => {
      const company = await companyFactory.create({ name: 'Test Co' });
      const rows = await faqRepo.createMany([
        { companyId: company.id, question: 'What are your hours?', answer: '9 to 5' },
        { companyId: company.id, question: 'Where are you located?', answer: 'Main St' },
      ]);

      const embA = new Array(1536).fill(0);
      embA[0] = 1.0;
      const embB = new Array(1536).fill(0);
      embB[1] = 1.0;

      await faqRepo.updateEmbeddings([
        { id: rows[0].id, embedding: embA },
        { id: rows[1].id, embedding: embB },
      ]);

      const results = await faqRepo.searchByEmbedding(company.id, embA, 5);
      expect(results).toHaveLength(2);
      expect(results[0].question).toBe('What are your hours?');
      expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    });

    it('returns empty array when no FAQs have embeddings', async () => {
      const company = await companyFactory.create({ name: 'Test Co' });
      await faqRepo.createMany([
        { companyId: company.id, question: 'Q1', answer: 'A1' },
      ]);

      const results = await faqRepo.searchByEmbedding(company.id, new Array(1536).fill(0.1), 5);
      expect(results).toEqual([]);
    });

    it('only returns FAQs for the specified company', async () => {
      const companyA = await companyFactory.create({ name: 'Co A' });
      const companyB = await companyFactory.create({ name: 'Co B' });

      const [faqA] = await faqRepo.createMany([
        { companyId: companyA.id, question: 'Q from A', answer: 'Answer A' },
      ]);
      await faqRepo.createMany([
        { companyId: companyB.id, question: 'Q from B', answer: 'Answer B' },
      ]);

      const embedding = new Array(1536).fill(0.1);
      await faqRepo.updateEmbeddings([{ id: faqA.id, embedding }]);

      const results = await faqRepo.searchByEmbedding(companyA.id, embedding, 5);
      expect(results).toHaveLength(1);
      expect(results[0].question).toBe('Q from A');
    });
  });
});
