import { pgTable, serial, varchar, jsonb } from 'drizzle-orm/pg-core';

export const skills = pgTable('skills', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }),
  settingsSchema: jsonb('settings_schema'),
  paramsSchema: jsonb('params_schema'),
});
