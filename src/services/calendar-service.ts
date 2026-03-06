import { injectable, inject } from 'tsyringe';
import { OAuth2Client } from 'google-auth-library';
import { CalendarRepository } from '../repositories/calendar-repository.js';
import { OperationHourRepository } from '../repositories/operation-hour-repository.js';
import type { GoogleCalendarClient } from './google-calendar-client.js';
import { RealGoogleCalendarClient } from './google-calendar-client.js';
import { parseDuration } from '../lib/parse-duration.js';
import { env } from '../config/env.js';

/** A time slot with start and end times. */
export interface TimeSlot {
  start: string;
  end: string;
}

/** Result of an availability check. */
export interface AvailabilityResult {
  timezone: string;
  availableSlots: TimeSlot[];
}

/** Parameters for booking an appointment. */
export interface BookAppointmentParams {
  summary: string;
  description?: string;
  startDateTime: string;
  endDateTime: string;
}

/** Result of a successful booking. */
export interface BookingResult {
  eventId: string;
  htmlLink: string;
}

/**
 * Orchestrates calendar operations with automatic token refresh.
 *
 * @precondition CalendarRepository and env credentials must be available.
 * @postcondition API calls use a valid (possibly refreshed) access token.
 */
@injectable()
export class CalendarService {
  constructor(
    @inject('CalendarRepository') private calendarRepo: CalendarRepository,
    @inject('OperationHourRepository') private operationHourRepo: OperationHourRepository,
  ) {}

  /**
   * Returns available time slots for a user's calendar within a date range.
   *
   * @param userId - The user whose calendar to query.
   * @param startDateTime - Start of the range in ISO 8601 format.
   * @param endDateTime - End of the range in ISO 8601 format.
   * @param duration - Slot duration string (e.g. "30m", "1h", "1h30m").
   * @returns The calendar timezone and available slots.
   * @throws {Error} If no calendar is found for the user.
   */
  async getAvailability(
    userId: number,
    startDateTime: string,
    endDateTime: string,
    duration: string,
  ): Promise<AvailabilityResult> {
    const calendar = await this.calendarRepo.findByUserId(userId);
    if (!calendar) throw new Error('No calendar found for user');

    const accessToken = await this.ensureValidToken(calendar);
    const client = new RealGoogleCalendarClient(accessToken);
    const timezone = await client.getCalendarTimezone(calendar.email);
    const { busySlots } = await client.queryFreeBusy(calendar.email, startDateTime, endDateTime);
    const operationHours = await this.operationHourRepo.findByCompanyId(calendar.companyId);
    const durationMs = parseDuration(duration);

    const availableSlots = computeAvailableSlots(
      new Date(startDateTime),
      new Date(endDateTime),
      busySlots.map(s => ({ start: new Date(s.start), end: new Date(s.end) })),
      operationHours,
      durationMs,
    );

    return { timezone, availableSlots };
  }

  /**
   * Books an appointment on the user's calendar.
   *
   * @param userId - The user whose calendar to book on.
   * @param params - Event details.
   * @returns The created event id and link.
   * @throws {Error} If no calendar is found for the user.
   */
  async bookAppointment(userId: number, params: BookAppointmentParams): Promise<BookingResult> {
    const { client, email } = await this.resolveClient(userId);
    const timezone = await client.getCalendarTimezone(email);
    const result = await client.createEvent(email, {
      summary: params.summary,
      description: params.description,
      startDateTime: params.startDateTime,
      endDateTime: params.endDateTime,
      timeZone: timezone,
    });
    return { eventId: result.eventId, htmlLink: result.htmlLink };
  }

  private async resolveClient(userId: number): Promise<{ client: GoogleCalendarClient; email: string }> {
    const calendar = await this.calendarRepo.findByUserId(userId);
    if (!calendar) throw new Error('No calendar found for user');

    const accessToken = await this.ensureValidToken(calendar);
    return { client: new RealGoogleCalendarClient(accessToken), email: calendar.email };
  }

  private async ensureValidToken(calendar: {
    id: number;
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: Date;
  }): Promise<string> {
    if (calendar.tokenExpiresAt > new Date()) {
      return calendar.accessToken;
    }
    return this.refreshToken(calendar);
  }

  private async refreshToken(calendar: {
    id: number;
    refreshToken: string;
  }): Promise<string> {
    const oauth2 = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
    oauth2.setCredentials({ refresh_token: calendar.refreshToken });
    const { credentials } = await oauth2.refreshAccessToken();
    const accessToken = credentials.access_token!;
    const refreshToken = credentials.refresh_token ?? calendar.refreshToken;
    const tokenExpiresAt = new Date(credentials.expiry_date!);

    await this.calendarRepo.updateTokens(calendar.id, {
      accessToken,
      refreshToken,
      tokenExpiresAt,
    });

    return accessToken;
  }
}

/**
 * Computes available slots from a time range, excluding busy periods
 * and restricting to operation hours.
 *
 * @param rangeStart - Start of the query range.
 * @param rangeEnd - End of the query range.
 * @param busySlots - Calendar busy periods.
 * @param operationHours - Business operation hours by day of week.
 * @param durationMs - Required slot duration in milliseconds.
 * @returns Available time slots that fit the duration.
 */
export function computeAvailableSlots(
  rangeStart: Date,
  rangeEnd: Date,
  busySlots: Array<{ start: Date; end: Date }>,
  operationHours: Array<{ dayOfWeek: number; openTime: string; closeTime: string }>,
  durationMs: number,
): TimeSlot[] {
  const openWindows = getOpenWindows(rangeStart, rangeEnd, operationHours);
  const sorted = [...busySlots].sort((a, b) => a.start.getTime() - b.start.getTime());
  const available: TimeSlot[] = [];

  for (const window of openWindows) {
    let cursor = window.start.getTime();
    const windowEnd = window.end.getTime();

    for (const busy of sorted) {
      const busyStart = busy.start.getTime();
      const busyEnd = busy.end.getTime();
      if (busyEnd <= cursor || busyStart >= windowEnd) continue;
      addSlots(available, cursor, Math.min(busyStart, windowEnd), durationMs);
      cursor = Math.max(cursor, busyEnd);
    }
    addSlots(available, cursor, windowEnd, durationMs);
  }

  return available;
}

function addSlots(slots: TimeSlot[], from: number, to: number, durationMs: number): void {
  let cursor = from;
  while (cursor + durationMs <= to) {
    slots.push({
      start: new Date(cursor).toISOString(),
      end: new Date(cursor + durationMs).toISOString(),
    });
    cursor += durationMs;
  }
}

function getOpenWindows(
  rangeStart: Date,
  rangeEnd: Date,
  operationHours: Array<{ dayOfWeek: number; openTime: string; closeTime: string }>,
): Array<{ start: Date; end: Date }> {
  if (operationHours.length === 0) {
    return [{ start: rangeStart, end: rangeEnd }];
  }

  const hoursByDay = new Map<number, Array<{ openTime: string; closeTime: string }>>();
  for (const oh of operationHours) {
    const existing = hoursByDay.get(oh.dayOfWeek) ?? [];
    existing.push(oh);
    hoursByDay.set(oh.dayOfWeek, existing);
  }

  const windows: Array<{ start: Date; end: Date }> = [];
  const current = new Date(rangeStart);
  current.setUTCHours(0, 0, 0, 0);

  while (current < rangeEnd) {
    const dayOfWeek = current.getUTCDay();
    const dayHours = hoursByDay.get(dayOfWeek) ?? [];

    for (const oh of dayHours) {
      const open = applyTimeToDate(current, oh.openTime);
      const close = applyTimeToDate(current, oh.closeTime);
      const windowStart = new Date(Math.max(open.getTime(), rangeStart.getTime()));
      const windowEnd = new Date(Math.min(close.getTime(), rangeEnd.getTime()));
      if (windowStart < windowEnd) {
        windows.push({ start: windowStart, end: windowEnd });
      }
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return windows;
}

function applyTimeToDate(date: Date, time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const result = new Date(date);
  result.setUTCHours(hours, minutes, 0, 0);
  return result;
}
