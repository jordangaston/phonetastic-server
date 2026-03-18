import { pgTable, serial, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const companies = pgTable('companies', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  businessType: varchar('business_type', { length: 255 }),
  website: varchar('website', { length: 2048 }),
  emails: varchar('emails', { length: 255 }).array().default(sql`'{}'`),
});
