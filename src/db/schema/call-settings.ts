import { pgTable, serial, integer, boolean } from 'drizzle-orm/pg-core';
import { phoneNumbers } from './phone-numbers';
import { users } from './users';
import { answerCallsFromEnum } from './enums';

export const callSettings = pgTable('call_settings', {
  id: serial('id').primaryKey(),
  forwardedPhoneNumberId: integer('forwarded_phone_number_id').notNull().references(() => phoneNumbers.id),
  companyPhoneNumberId: integer('company_phone_number_id').notNull().references(() => phoneNumbers.id),
  userId: integer('user_id').notNull().references(() => users.id),
  isBotEnabled: boolean('is_bot_enabled').notNull().default(false),
  ringsBeforeBotAnswer: integer('rings_before_bot_answer').notNull().default(3),
  answerCallsFrom: answerCallsFromEnum('answer_calls_from').notNull().default('everyone'),
});
