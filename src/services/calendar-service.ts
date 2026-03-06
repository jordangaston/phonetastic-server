import { injectable, inject } from 'tsyringe';
import { OAuth2Client } from 'google-auth-library';
import { CalendarRepository } from '../repositories/calendar-repository.js';
import type { GoogleCalendarClient } from './google-calendar-client.js';
import { RealGoogleCalendarClient } from './google-calendar-client.js';
import { env } from '../config/env.js';

/** Busy slot returned by availability check. */
export interface BusySlot {
  start: string;
  end: string;
}

/** Result of an availability check. */
export interface AvailabilityResult {
  timezone: string;
  busySlots: BusySlot[];
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
  ) {}

  /**
   * Checks availability for a user's calendar within a time range.
   *
   * @param userId - The user whose calendar to query.
   * @param startDateTime - Start of the range in ISO 8601 format (e.g. "2026-03-15T09:00:00").
   * @param endDateTime - End of the range in ISO 8601 format (e.g. "2026-03-15T17:00:00").
   * @returns The calendar timezone and busy slots within the range.
   * @throws {Error} If no calendar is found for the user.
   */
  async checkAvailability(userId: number, startDateTime: string, endDateTime: string): Promise<AvailabilityResult> {
    const { client, email } = await this.resolveClient(userId);
    const timezone = await client.getCalendarTimezone(email);
    const result = await client.queryFreeBusy(email, startDateTime, endDateTime);
    return { timezone, busySlots: result.busySlots };
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
