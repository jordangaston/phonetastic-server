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