import { relations } from 'drizzle-orm';
import { calls } from './calls';
import { callParticipants } from './call-participants';
import { callTranscripts } from './call-transcripts';
import { callTranscriptEntries } from './call-transcript-entries';
import { companies } from './companies';
import { addresses } from './addresses';
import { operationHours } from './operation-hours';
import { phoneNumbers } from './phone-numbers';
import { faqs } from './faqs';
import { offerings } from './offerings';
import { users } from './users';
import { bots } from './bots';
import { skills } from './skills';
import { botSkills } from './bot-skills';
import { endUsers } from './end-users';
import { emailAddresses } from './email-addresses';
import { chats } from './chats';
import { emails } from './emails';
import { attachments } from './attachments';
import { botToolCalls } from './bot-tool-calls';
import { subdomains } from './subdomains';

export const callsRelations = relations(calls, ({ one, many }) => ({
  transcript: one(callTranscripts, { fields: [calls.id], references: [callTranscripts.callId] }),
  participants: many(callParticipants),
}));

export const callParticipantsRelations = relations(callParticipants, ({ one }) => ({
  call: one(calls, { fields: [callParticipants.callId], references: [calls.id] }),
}));

export const callTranscriptsRelations = relations(callTranscripts, ({ one, many }) => ({
  call: one(calls, { fields: [callTranscripts.callId], references: [calls.id] }),
  entries: many(callTranscriptEntries),
}));

export const callTranscriptEntriesRelations = relations(callTranscriptEntries, ({ one }) => ({
  transcript: one(callTranscripts, { fields: [callTranscriptEntries.transcriptId], references: [callTranscripts.id] }),
}));

export const companiesRelations = relations(companies, ({ many }) => ({
  addresses: many(addresses),
  operationHours: many(operationHours),
  phoneNumbers: many(phoneNumbers),
  faqs: many(faqs),
  offerings: many(offerings),
  emailAddresses: many(emailAddresses),
  subdomains: many(subdomains),
  chats: many(chats),
}));

export const addressesRelations = relations(addresses, ({ one }) => ({
  company: one(companies, { fields: [addresses.companyId], references: [companies.id] }),
}));

export const operationHoursRelations = relations(operationHours, ({ one }) => ({
  company: one(companies, { fields: [operationHours.companyId], references: [companies.id] }),
}));

export const phoneNumbersRelations = relations(phoneNumbers, ({ one }) => ({
  company: one(companies, { fields: [phoneNumbers.companyId], references: [companies.id] }),
}));

export const faqsRelations = relations(faqs, ({ one }) => ({
  company: one(companies, { fields: [faqs.companyId], references: [companies.id] }),
}));

export const offeringsRelations = relations(offerings, ({ one }) => ({
  company: one(companies, { fields: [offerings.companyId], references: [companies.id] }),
}));

export const usersRelations = relations(users, ({ one }) => ({
  phoneNumber: one(phoneNumbers, { fields: [users.phoneNumberId], references: [phoneNumbers.id] }),
  bot: one(bots, { fields: [users.id], references: [bots.userId] }),
}));

export const botsRelations = relations(bots, ({ many }) => ({
  botSkills: many(botSkills),
}));

export const skillsRelations = relations(skills, ({ many }) => ({
  botSkills: many(botSkills),
}));

export const botSkillsRelations = relations(botSkills, ({ one }) => ({
  bot: one(bots, { fields: [botSkills.botId], references: [bots.id] }),
  skill: one(skills, { fields: [botSkills.skillId], references: [skills.id] }),
}));

export const emailAddressesRelations = relations(emailAddresses, ({ one }) => ({
  company: one(companies, { fields: [emailAddresses.companyId], references: [companies.id] }),
}));

export const chatsRelations = relations(chats, ({ one, many }) => ({
  company: one(companies, { fields: [chats.companyId], references: [companies.id] }),
  endUser: one(endUsers, { fields: [chats.endUserId], references: [endUsers.id] }),
  emailAddress: one(emailAddresses, { fields: [chats.emailAddressId], references: [emailAddresses.id] }),
  emails: many(emails),
  botToolCalls: many(botToolCalls),
}));

export const emailsRelations = relations(emails, ({ one, many }) => ({
  chat: one(chats, { fields: [emails.chatId], references: [chats.id] }),
  attachments: many(attachments),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  email: one(emails, { fields: [attachments.emailId], references: [emails.id] }),
}));

export const subdomainsRelations = relations(subdomains, ({ one }) => ({
  company: one(companies, { fields: [subdomains.companyId], references: [companies.id] }),
}));

export const botToolCallsRelations = relations(botToolCalls, ({ one }) => ({
  chat: one(chats, { fields: [botToolCalls.chatId], references: [chats.id] }),
}));