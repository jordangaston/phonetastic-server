import { pgTable, serial, integer, varchar, timestamp } from 'drizzle-orm/pg-core';
import { calendarProviderEnum } from './enums';
import { users } from './users';
import { companies } from './companies';

export const calendars = pgTable('calendars', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  companyId: integer('company_id').notNull().references(() => companies.id),
  provider: calendarProviderEnum('provider').notNull(),
  externalId: varchar('external_id', { length: 255 }),
  name: varchar('name', { length: 255 }),
  description: varchar('description', { length: 1024 }),
  email: varchar('email', { length: 255 }).notNull(),
  accessToken: varchar('access_token', { length: 4096 }).notNull(),
  refreshToken: varchar('refresh_token', { length: 4096 }).notNull(),
  tokenExpiresAt: timestamp('token_expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
