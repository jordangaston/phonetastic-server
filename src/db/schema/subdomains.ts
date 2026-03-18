import { pgTable, serial, integer, varchar, timestamp } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { subdomainStatusEnum } from './enums';

export const subdomains = pgTable('subdomains', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull().references(() => companies.id),
  subdomain: varchar('subdomain', { length: 63 }).notNull().unique(),
  resendDomainId: varchar('resend_domain_id', { length: 255 }),
  status: subdomainStatusEnum('status').notNull().default('not_started'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
