import { pgEnum } from 'drizzle-orm/pg-core';

export const callStateEnum = pgEnum('call_state', [
  'waiting',
  'connecting',
  'connected',
  'finished',
  'failed',
]);
export type CallState = (typeof callStateEnum.enumValues)[number];

export const callDirectionEnum = pgEnum('call_direction', [
  'inbound',
  'outbound',
]);

export const participantTypeEnum = pgEnum('participant_type', [
  'agent',
  'bot',
  'end_user',
]);
export type ParticipantType = (typeof participantTypeEnum.enumValues)[number];

export const calendarProviderEnum = pgEnum('calendar_provider', [
  'google',
]);

export const offeringTypeEnum = pgEnum('offering_type', [
  'product',
  'service',
]);

export const priceFrequencyEnum = pgEnum('price_frequency', [
  'one_time',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'yearly',
]);

export const answerCallsFromEnum = pgEnum('answer_calls_from', [
  'everyone',
  'unknown',
  'contacts',
]);
export type AnswerCallsFrom = (typeof answerCallsFromEnum.enumValues)[number];

export const smsDirectionEnum = pgEnum('sms_direction', [
  'inbound',
  'outbound',
]);
export type SmsDirection = (typeof smsDirectionEnum.enumValues)[number];

export const smsStateEnum = pgEnum('sms_state', [
  'pending',
  'sent',
  'delivered',
  'failed',
  'received',
]);
export type SmsState = (typeof smsStateEnum.enumValues)[number];

export const chatChannelEnum = pgEnum('chat_channel', ['email']);
export type ChatChannel = (typeof chatChannelEnum.enumValues)[number];

export const chatStatusEnum = pgEnum('chat_status', ['open', 'closed']);
export type ChatStatus = (typeof chatStatusEnum.enumValues)[number];

export const emailDirectionEnum = pgEnum('email_direction', ['inbound', 'outbound']);
export type EmailDirection = (typeof emailDirectionEnum.enumValues)[number];

export const emailStatusEnum = pgEnum('email_status', ['received', 'pending', 'sent', 'failed']);
export type EmailStatus = (typeof emailStatusEnum.enumValues)[number];

export const attachmentStatusEnum = pgEnum('attachment_status', ['pending', 'stored', 'failed']);
export type AttachmentStatus = (typeof attachmentStatusEnum.enumValues)[number];