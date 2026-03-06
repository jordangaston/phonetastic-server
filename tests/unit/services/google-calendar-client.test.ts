import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealGoogleCalendarClient } from '../../../src/services/google-calendar-client.js';
import { BadRequestError, ServerError } from '../../../src/lib/errors.js';

describe('RealGoogleCalendarClient', () => {
  let client: RealGoogleCalendarClient;
  const mockFetch = vi.fn();

  beforeEach(() => {
    client = new RealGoogleCalendarClient('test-token');
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getCalendarTimezone', () => {
    it('returns the calendar timezone', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ timeZone: 'America/Chicago' }),
      });

      const tz = await client.getCalendarTimezone('user@example.com');

      expect(tz).toBe('America/Chicago');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.googleapis.com/calendar/v3/calendars/user%40example.com',
        { headers: { Authorization: 'Bearer test-token' } },
      );
    });

    it('throws BadRequestError on 4xx', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(client.getCalendarTimezone('user@example.com'))
        .rejects.toThrow(BadRequestError);
    });

    it('throws ServerError on 5xx', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => 'Bad Gateway',
      });

      await expect(client.getCalendarTimezone('user@example.com'))
        .rejects.toThrow(ServerError);
    });
  });

  describe('queryFreeBusy', () => {
    it('returns busy slots for the calendar', async () => {
      const busy = [{ start: '2026-03-06T09:00:00Z', end: '2026-03-06T10:00:00Z' }];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ calendars: { 'user@example.com': { busy } } }),
      });

      const result = await client.queryFreeBusy('user@example.com', '2026-03-06T00:00:00Z', '2026-03-06T23:59:59Z');

      expect(result.busySlots).toEqual(busy);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.googleapis.com/calendar/v3/freeBusy',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns empty slots when calendar key is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ calendars: {} }),
      });

      const result = await client.queryFreeBusy('user@example.com', '2026-03-06T00:00:00Z', '2026-03-06T23:59:59Z');

      expect(result.busySlots).toEqual([]);
    });
  });

  describe('createEvent', () => {
    it('creates an event and returns the result', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'event-123',
          htmlLink: 'https://calendar.google.com/event/123',
          start: { dateTime: '2026-03-06T14:00:00-05:00' },
          end: { dateTime: '2026-03-06T15:00:00-05:00' },
        }),
      });

      const result = await client.createEvent('user@example.com', {
        summary: 'Haircut',
        startDateTime: '2026-03-06T14:00:00-05:00',
        endDateTime: '2026-03-06T15:00:00-05:00',
        timeZone: 'America/Chicago',
      });

      expect(result.eventId).toBe('event-123');
      expect(result.htmlLink).toBe('https://calendar.google.com/event/123');
      expect(result.start).toBe('2026-03-06T14:00:00-05:00');
      expect(result.end).toBe('2026-03-06T15:00:00-05:00');
    });

    it('throws BadRequestError on 4xx', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      await expect(client.createEvent('user@example.com', {
        summary: 'Haircut',
        startDateTime: '2026-03-06T14:00:00-05:00',
        endDateTime: '2026-03-06T15:00:00-05:00',
        timeZone: 'America/Chicago',
      })).rejects.toThrow(BadRequestError);
    });

    it('throws ServerError on 5xx', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(client.createEvent('user@example.com', {
        summary: 'Haircut',
        startDateTime: '2026-03-06T14:00:00-05:00',
        endDateTime: '2026-03-06T15:00:00-05:00',
        timeZone: 'America/Chicago',
      })).rejects.toThrow(ServerError);
    });
  });
});
