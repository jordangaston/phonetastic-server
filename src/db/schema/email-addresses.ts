import { pgTable, serial, integer, varchar, timestamp } from 'drizzle-orm/pg-core';
import { companies } from './companies';

export const emailAddresses = pgTable('email_addresses', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull().references(() => companies.id),
  address: varchar('address', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
