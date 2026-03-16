import { pgTable, serial, integer, varchar } from 'drizzle-orm/pg-core';
import { phoneNumbers } from './phone-numbers';
import { companies } from './companies';

export const endUsers = pgTable('end_users', {
  id: serial('id').primaryKey(),
  phoneNumberId: integer('phone_number_id').references(() => phoneNumbers.id),
  companyId: integer('company_id').notNull().references(() => companies.id),
  firstName: varchar('first_name', { length: 255 }),
  lastName: varchar('last_name', { length: 255 }),
  email: varchar('email', { length: 255 }),
});
