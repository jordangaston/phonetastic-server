import { pgTable, serial, integer, text, vector } from 'drizzle-orm/pg-core';
import { companies } from './companies';

export const faqs = pgTable('faqs', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id')
    .notNull()
    .references(() => companies.id),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }),
});
