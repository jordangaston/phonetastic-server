/**
 * Lightweight Google Calendar REST API client.
 *
 * Uses direct `fetch` calls instead of the heavy `googleapis` package.
 * Accepts an access token at construction time — the caller is responsible
 * for refreshing expired tokens before creating an instance.
 */

import { BadRequestError, ServerError } from '../lib/errors.js';

const BASE_URL = 'https://www.googleapis.com/calendar/v3';

/** A busy time interval returned by the FreeBusy API. */
export interface BusySlot {
  start: string;
  end: string;
}

/** Result of a FreeBusy query. */
export interface FreeBusyResult {
  busySlots: BusySlot[];
}

/** Metadata about a calendar resource. */
export interface CalendarMetadata {
  externalId: string;
  name: string;
  description: string | null;
}

/** Result of an event creation. */
export interface CreateEventResult {
  eventId: string;
  htmlLink: string;
  start: string;
  end: string;
}

/** Parameters for creating a calendar event. */
export interface CreateEventParams {
  summary: string;
  description?: string;
  startDateTime: string;
  endDateTime: string;
  timeZone: string;
}

/**
 * Google Calendar REST API client interface.
 */
export interface GoogleCalendarClient {
  /**
   * Returns metadata (external id, name, description) for the given calendar.
   *
   * @param calendarId - The calendar email / id.
   * @returns The calendar metadata.
   */
  getCalendarMetadata(calendarId: string): Promise<CalendarMetadata>;

  /**
   * Returns the IANA timezone of the given calendar.
   *
   * @param calendarId - The calendar email / id.
   * @returns The IANA timezone string (e.g. "America/New_York").
   */
  getCalendarTimezone(calendarId: string): Promise<string>;

  /**
   * Queries the FreeBusy API for busy intervals.
   *
   * @param calendarId - The calendar email / id.
   * @param timeMin - Start of the window (ISO-8601).
   * @param timeMax - End of the window (ISO-8601).
   * @returns The busy slots within the window.
   */
  queryFreeBusy(calendarId: string, timeMin: string, timeMax: string): Promise<FreeBusyResult>;

  /**
   * Creates a new event on the calendar.
   *
   * @param calendarId - The calendar email / id.
   * @param params - Event details.
   * @returns The created event summary.
   */
  createEvent(calendarId: string, params: CreateEventParams): Promise<CreateEventResult>;
}

/**
 * Production implementation that calls the real Google Calendar REST API.
 *
 * @precondition `accessToken` must be a valid, non-expired OAuth2 access token.
 * @postcondition HTTP calls are made to the Google Calendar v3 API.
 */
export class RealGoogleCalendarClient implements GoogleCalendarClient {
  constructor(private readonly accessToken: string) {}

  /** {@inheritDoc GoogleCalendarClient.getCalendarMetadata} */
  async getCalendarMetadata(calendarId: string): Promise<CalendarMetadata> {
    const body = await this.fetchCalendarResource(calendarId);
    return {
      externalId: body.id,
      name: body.summary,
      description: body.description ?? null,
    };
  }

  /** {@inheritDoc GoogleCalendarClient.getCalendarTimezone} */
  async getCalendarTimezone(calendarId: string): Promise<string> {
    const body = await this.fetchCalendarResource(calendarId);
    return body.timeZone;
  }

  /** {@inheritDoc GoogleCalendarClient.queryFreeBusy} */
  async queryFreeBusy(calendarId: string, timeMin: string, timeMax: string): Promise<FreeBusyResult> {
    const url = `${BASE_URL}/freeBusy`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin,
        timeMax,
        items: [{ id: calendarId }],
      }),
    });
    await this.assertOk(res);
    const body = await res.json() as { calendars: Record<string, { busy: BusySlot[] }> };
    const cal = body.calendars[calendarId];
    return { busySlots: cal?.busy ?? [] };
  }

  /** {@inheritDoc GoogleCalendarClient.createEvent} */
  async createEvent(calendarId: string, params: CreateEventParams): Promise<CreateEventResult> {
    const url = `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: params.summary,
        description: params.description,
        start: { dateTime: params.startDateTime, timeZone: params.timeZone },
        end: { dateTime: params.endDateTime, timeZone: params.timeZone },
      }),
    });
    await this.assertOk(res);
    const body = await res.json() as { id: string; htmlLink: string; start: { dateTime: string }; end: { dateTime: string } };
    return {
      eventId: body.id,
      htmlLink: body.htmlLink,
      start: body.start.dateTime,
      end: body.end.dateTime,
    };
  }

  private async fetchCalendarResource(calendarId: string) {
    const url = `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}`;
    const res = await fetch(url, { headers: this.authHeaders() });
    await this.assertOk(res);
    return await res.json() as {
      id: string;
      summary: string;
      description?: string;
      timeZone: string;
    };
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  private async assertOk(res: Response): Promise<void> {
    if (res.ok) return;
    const text = await res.text();
    const message = `Google Calendar API error ${res.status}: ${text}`;
    if (res.status >= 500) throw new ServerError(message);
    throw new BadRequestError(message);
  }
}

/**
 * Stub implementation for development and testing.
 */
export class StubGoogleCalendarClient implements GoogleCalendarClient {
  public timezone = 'America/New_York';
  public busySlots: BusySlot[] = [];
  public createdEvents: CreateEventParams[] = [];
  public metadata: CalendarMetadata = {
    externalId: 'stub-calendar-id',
    name: 'Stub Calendar',
    description: null,
  };

  async getCalendarMetadata(): Promise<CalendarMetadata> {
    return this.metadata;
  }

  async getCalendarTimezone(): Promise<string> {
    return this.timezone;
  }

  async queryFreeBusy(): Promise<FreeBusyResult> {
    return { busySlots: this.busySlots };
  }

  async createEvent(_calendarId: string, params: CreateEventParams): Promise<CreateEventResult> {
    this.createdEvents.push(params);
    return {
      eventId: 'stub-event-id',
      htmlLink: 'https://calendar.google.com/stub',
      start: params.startDateTime,
      end: params.endDateTime,
    };
  }
}
