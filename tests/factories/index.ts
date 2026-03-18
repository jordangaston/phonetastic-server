import { Factory } from 'fishery';
import { getTestDb } from '../helpers/test-app.js';
import { voices } from '../../src/db/schema/voices.js';
import { companies } from '../../src/db/schema/companies.js';
import { skills } from '../../src/db/schema/skills.js';
import { phoneNumbers } from '../../src/db/schema/phone-numbers.js';
import { calls } from '../../src/db/schema/calls.js';
import { callTranscripts } from '../../src/db/schema/call-transcripts.js';
import { emailAddresses } from '../../src/db/schema/email-addresses.js';
import { chats } from '../../src/db/schema/chats.js';
import { emails } from '../../src/db/schema/emails.js';
import { attachments } from '../../src/db/schema/attachments.js';
import { botToolCalls } from '../../src/db/schema/bot-tool-calls.js';
import { endUsers } from '../../src/db/schema/end-users.js';
import { subdomains } from '../../src/db/schema/subdomains.js';

type VoiceRow = typeof voices.$inferSelect;
type CompanyRow = typeof companies.$inferSelect;
type SkillRow = typeof skills.$inferSelect;
type PhoneNumberRow = typeof phoneNumbers.$inferSelect;
type CallRow = typeof calls.$inferSelect;
type CallTranscriptRow = typeof callTranscripts.$inferSelect;
type EmailAddressRow = typeof emailAddresses.$inferSelect;
type ChatRow = typeof chats.$inferSelect;
type EmailRow = typeof emails.$inferSelect;
type AttachmentRow = typeof attachments.$inferSelect;
type BotToolCallRow = typeof botToolCalls.$inferSelect;
type EndUserRow = typeof endUsers.$inferSelect;
type SubdomainRow = typeof subdomains.$inferSelect;

export const voiceFactory = Factory.define<VoiceRow>(({ sequence }) => ({
  id: sequence,
  name: `Voice ${sequence}`,
  supportedLanguages: ['en'],
  snippet: '',
  snippetMimeType: 'audio/mp3',
  externalId: `ext-voice-${sequence}`,
})).onCreate(async (voice) => {
  const [row] = await getTestDb().insert(voices).values({
    name: voice.name,
    supportedLanguages: voice.supportedLanguages,
    snippet: voice.snippet,
    snippetMimeType: voice.snippetMimeType,
    externalId: voice.externalId,
  }).returning();
  return row;
});

export const companyFactory = Factory.define<CompanyRow>(({ sequence }) => ({
  id: sequence,
  name: `Test Company ${sequence}`,
  businessType: null,
  website: null,
  emails: [],
})).onCreate(async (company) => {
  const [row] = await getTestDb().insert(companies).values({
    name: company.name,
    businessType: company.businessType ?? undefined,
    website: company.website ?? undefined,
  }).returning();
  return row;
});

export const skillFactory = Factory.define<SkillRow>(({ sequence }) => ({
  id: sequence,
  name: `Skill ${sequence}`,
  allowedTools: [],
  description: `Description for skill ${sequence}`,
  instructions: `Instructions for skill ${sequence}`,
})).onCreate(async (skill) => {
  const [row] = await getTestDb().insert(skills).values({
    name: skill.name,
    allowedTools: skill.allowedTools,
    description: skill.description,
    instructions: skill.instructions,
  }).returning();
  return row;
});

export const phoneNumberFactory = Factory.define<PhoneNumberRow>(({ sequence }) => ({
  id: sequence,
  phoneNumberE164: `+1555000${sequence.toString().padStart(4, '0')}`,
  companyId: null,
  isVerified: false,
  label: null,
})).onCreate(async (phoneNumber) => {
  const [row] = await getTestDb().insert(phoneNumbers).values({
    phoneNumberE164: phoneNumber.phoneNumberE164,
    companyId: phoneNumber.companyId ?? undefined,
  }).returning();
  return row;
});

export const callFactory = Factory.define<CallRow>(({ sequence }) => ({
  id: sequence,
  externalCallId: `room-${sequence}`,
  companyId: 0,
  fromPhoneNumberId: 0,
  toPhoneNumberId: 0,
  state: 'connecting',
  direction: 'inbound',
  testMode: false,
  failureReason: null,
  createdAt: new Date(),
})).onCreate(async (call) => {
  const [row] = await getTestDb().insert(calls).values({
    externalCallId: call.externalCallId,
    companyId: call.companyId,
    fromPhoneNumberId: call.fromPhoneNumberId,
    toPhoneNumberId: call.toPhoneNumberId,
    state: call.state,
    testMode: call.testMode,
  }).returning();
  return row;
});

export const callTranscriptFactory = Factory.define<CallTranscriptRow>(({ sequence }) => ({
  id: sequence,
  callId: 0,
  summary: null,
  createdAt: new Date(),
})).onCreate(async (transcript) => {
  const [row] = await getTestDb().insert(callTranscripts).values({
    callId: transcript.callId,
  }).returning();
  return row;
});

export const endUserFactory = Factory.define<EndUserRow>(({ sequence }) => ({
  id: sequence,
  phoneNumberId: null,
  companyId: 0,
  firstName: null,
  lastName: null,
  email: null,
})).onCreate(async (endUser) => {
  const [row] = await getTestDb().insert(endUsers).values({
    phoneNumberId: endUser.phoneNumberId ?? undefined,
    companyId: endUser.companyId,
    email: endUser.email ?? undefined,
  }).returning();
  return row;
});

export const emailAddressFactory = Factory.define<EmailAddressRow>(({ sequence }) => ({
  id: sequence,
  companyId: 0,
  address: `company-${sequence}@mail.phonetastic.ai`,
  createdAt: new Date(),
})).onCreate(async (emailAddress) => {
  const [row] = await getTestDb().insert(emailAddresses).values({
    companyId: emailAddress.companyId,
    address: emailAddress.address,
  }).returning();
  return row;
});

export const chatFactory = Factory.define<ChatRow>(({ sequence }) => ({
  id: sequence,
  companyId: 0,
  endUserId: 0,
  channel: 'email',
  status: 'open',
  botEnabled: true,
  subject: null,
  summary: null,
  emailAddressId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
})).onCreate(async (chat) => {
  const [row] = await getTestDb().insert(chats).values({
    companyId: chat.companyId,
    endUserId: chat.endUserId,
    channel: chat.channel,
    status: chat.status,
    botEnabled: chat.botEnabled,
    subject: chat.subject ?? undefined,
    emailAddressId: chat.emailAddressId ?? undefined,
  }).returning();
  return row;
});

export const emailFactory = Factory.define<EmailRow>(({ sequence }) => ({
  id: sequence,
  chatId: 0,
  direction: 'inbound',
  endUserId: null,
  botId: null,
  userId: null,
  subject: null,
  bodyText: null,
  bodyHtml: null,
  externalEmailId: null,
  messageId: null,
  inReplyTo: null,
  referenceIds: null,
  from: null,
  to: null,
  forwardedTo: null,
  replyTo: null,
  status: 'received',
  createdAt: new Date(),
})).onCreate(async (email) => {
  const [row] = await getTestDb().insert(emails).values({
    chatId: email.chatId,
    direction: email.direction,
    endUserId: email.endUserId ?? undefined,
    botId: email.botId ?? undefined,
    userId: email.userId ?? undefined,
    subject: email.subject ?? undefined,
    bodyText: email.bodyText ?? undefined,
    bodyHtml: email.bodyHtml ?? undefined,
    externalEmailId: email.externalEmailId ?? undefined,
    messageId: email.messageId ?? undefined,
    inReplyTo: email.inReplyTo ?? undefined,
    referenceIds: email.referenceIds ?? undefined,
    status: email.status,
  }).returning();
  return row;
});

export const attachmentFactory = Factory.define<AttachmentRow>(({ sequence }) => ({
  id: sequence,
  emailId: 0,
  externalAttachmentId: null,
  filename: `file-${sequence}.pdf`,
  contentType: 'application/pdf',
  sizeBytes: null,
  storageKey: null,
  status: 'pending',
  summary: null,
  createdAt: new Date(),
})).onCreate(async (attachment) => {
  const [row] = await getTestDb().insert(attachments).values({
    emailId: attachment.emailId,
    externalAttachmentId: attachment.externalAttachmentId ?? undefined,
    filename: attachment.filename,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes ?? undefined,
    storageKey: attachment.storageKey ?? undefined,
    status: attachment.status,
    summary: attachment.summary ?? undefined,
  }).returning();
  return row;
});

export const botToolCallFactory = Factory.define<BotToolCallRow>(({ sequence }) => ({
  id: sequence,
  chatId: 0,
  toolCallId: `tc-${sequence}`,
  toolName: 'company_info',
  input: { query: 'test query' },
  output: { found: false },
  createdAt: new Date(),
})).onCreate(async (tc) => {
  const [row] = await getTestDb().insert(botToolCalls).values({
    chatId: tc.chatId,
    toolCallId: tc.toolCallId,
    toolName: tc.toolName,
    input: tc.input,
    output: tc.output,
  }).returning();
  return row;
});

export const subdomainFactory = Factory.define<SubdomainRow>(({ sequence }) => ({
  id: sequence,
  companyId: 0,
  subdomain: `sub-${sequence}`,
  resendDomainId: null,
  status: 'not_started',
  createdAt: new Date(),
})).onCreate(async (sub) => {
  const [row] = await getTestDb().insert(subdomains).values({
    companyId: sub.companyId,
    subdomain: sub.subdomain,
  }).returning();
  return row;
});
