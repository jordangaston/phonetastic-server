import { pgTable, serial, integer, varchar, text, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { emailDirectionEnum, emailStatusEnum } from './enums';
import { chats } from './chats';
import { endUsers } from './end-users';
import { bots } from './bots';
import { users } from './users';

export const emails = pgTable('emails', {
  id: serial('id').primaryKey(),
  chatId: integer('chat_id').notNull().references(() => chats.id),
  direction: emailDirectionEnum('direction').notNull(),
  endUserId: integer('end_user_id').references(() => endUsers.id),
  botId: integer('bot_id').references(() => bots.id),
  userId: integer('user_id').references(() => users.id),
  subject: varchar('subject', { length: 1024 }),
  bodyText: text('body_text'),
  bodyHtml: text('body_html'),
  externalEmailId: varchar('external_email_id', { length: 255 }).unique(),
  messageId: varchar('message_id', { length: 512 }),
  inReplyTo: varchar('in_reply_to', { length: 512 }),
  referenceIds: text('reference_ids').array(),
  status: emailStatusEnum('status').notNull().default('received'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  check(
    'exactly_one_sender',
    sql`(
      (CASE WHEN ${table.endUserId} IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN ${table.botId} IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN ${table.userId} IS NOT NULL THEN 1 ELSE 0 END)
    ) = 1`,
  ),
]);
