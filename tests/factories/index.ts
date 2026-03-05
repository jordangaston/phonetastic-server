import { Factory } from 'fishery';
import { getTestDb } from '../helpers/test-app.js';
import { voices } from '../../src/db/schema/voices.js';
import { companies } from '../../src/db/schema/companies.js';
import { skills } from '../../src/db/schema/skills.js';
import { phoneNumbers } from '../../src/db/schema/phone-numbers.js';
import { calls } from '../../src/db/schema/calls.js';
import { callTranscripts } from '../../src/db/schema/call-transcripts.js';

type VoiceRow = typeof voices.$inferSelect;
type CompanyRow = typeof companies.$inferSelect;
type SkillRow = typeof skills.$inferSelect;
type PhoneNumberRow = typeof phoneNumbers.$inferSelect;
type CallRow = typeof calls.$inferSelect;
type CallTranscriptRow = typeof callTranscripts.$inferSelect;

export const voiceFactory = Factory.define<VoiceRow>(({ sequence }) => ({
  id: sequence,
  name: `Voice ${sequence}`,
  supportedLanguages: ['en'],
  snippet: '',
  snippetMimeType: 'audio/mp3',
})).onCreate(async (voice) => {
  const [row] = await getTestDb().insert(voices).values({
    name: voice.name,
    supportedLanguages: voice.supportedLanguages,
    snippet: voice.snippet,
    snippetMimeType: voice.snippetMimeType,
  }).returning();
  return row;
});

export const companyFactory = Factory.define<CompanyRow>(({ sequence }) => ({
  id: sequence,
  name: `Test Company ${sequence}`,
  businessType: null,
  website: null,
  email: null,
})).onCreate(async (company) => {
  const [row] = await getTestDb().insert(companies).values({
    name: company.name,
    businessType: company.businessType ?? undefined,
    website: company.website ?? undefined,
    email: company.email ?? undefined,
  }).returning();
  return row;
});

export const skillFactory = Factory.define<SkillRow>(({ sequence }) => ({
  id: sequence,
  name: `Skill ${sequence}`,
  settingsSchema: {},
  paramsSchema: {},
})).onCreate(async (skill) => {
  const [row] = await getTestDb().insert(skills).values({
    name: skill.name,
    settingsSchema: skill.settingsSchema,
    paramsSchema: skill.paramsSchema,
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
