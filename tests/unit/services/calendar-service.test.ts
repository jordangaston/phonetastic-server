import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CalendarService } from '../../../src/services/calendar-service.js';

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    setCredentials: vi.fn(),
    refreshAccessToken: vi.fn().mockResolvedValue({
      credentials: {
        access_token: 'refreshed-access',
        refresh_token: 'refreshed-refresh',
        expiry_date: Date.now() + 3600_000,
      },
    }),
  })),
}));

vi.mock('../../../src/services/google-calendar-client.js', () => ({
  RealGoogleCalendarClient: vi.fn().mockImplementation(() => mockClient),
}));

vi.mock('../../../src/config/env.js', () => ({
  env: {
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
  },
}));

let mockClient: any;

describe('CalendarService', () => {
  let calendarRepo: any;
  let service: CalendarService;

  const validCalendar = {
    id: 1,
    userId: 10,
    companyId: 5,
    provider: 'google' as const,
    email: 'user@example.com',
    accessToken: 'valid-access',
    refreshToken: 'valid-refresh',
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    createdAt: new Date(),
  };

  beforeEach(() => {
    calendarRepo = {
      findByUserId: vi.fn(),
      updateTokens: vi.fn().mockResolvedValue(undefined),
    };
    mockClient = {
      getCalendarTimezone: vi.fn().mockResolvedValue('America/New_York'),
      queryFreeBusy: vi.fn().mockResolvedValue({ busySlots: [{ start: '2026-03-15T09:00:00', end: '2026-03-15T10:00:00' }] }),
      createEvent: vi.fn().mockResolvedValue({ eventId: 'evt-1', htmlLink: 'https://cal.google.com/evt-1', start: '2026-03-15T14:00:00', end: '2026-03-15T15:00:00' }),
    };
    service = new CalendarService(calendarRepo);
  });

  describe('checkAvailability', () => {
    it('returns busy slots for the given time range', async () => {
      calendarRepo.findByUserId.mockResolvedValue(validCalendar);

      const result = await service.checkAvailability(10, '2026-03-15T09:00:00', '2026-03-15T17:00:00');

      expect(result.timezone).toBe('America/New_York');
      expect(result.busySlots).toHaveLength(1);
      expect(mockClient.queryFreeBusy).toHaveBeenCalledWith('user@example.com', '2026-03-15T09:00:00', '2026-03-15T17:00:00');
    });

    it('throws when no calendar is found', async () => {
      calendarRepo.findByUserId.mockResolvedValue(undefined);

      await expect(service.checkAvailability(10, '2026-03-15T09:00:00', '2026-03-15T17:00:00')).rejects.toThrow('No calendar found for user');
    });
  });

  describe('bookAppointment', () => {
    it('creates event and returns result', async () => {
      calendarRepo.findByUserId.mockResolvedValue(validCalendar);

      const result = await service.bookAppointment(10, {
        summary: 'Haircut',
        startDateTime: '2026-03-15T14:00:00-04:00',
        endDateTime: '2026-03-15T15:00:00-04:00',
      });

      expect(result.eventId).toBe('evt-1');
      expect(result.htmlLink).toBe('https://cal.google.com/evt-1');
      expect(mockClient.createEvent).toHaveBeenCalledWith('user@example.com', expect.objectContaining({
        summary: 'Haircut',
        timeZone: 'America/New_York',
      }));
    });

    it('throws when no calendar is found', async () => {
      calendarRepo.findByUserId.mockResolvedValue(undefined);

      await expect(service.bookAppointment(10, {
        summary: 'Haircut',
        startDateTime: '2026-03-15T14:00:00-04:00',
        endDateTime: '2026-03-15T15:00:00-04:00',
      })).rejects.toThrow('No calendar found for user');
    });
  });

  describe('token refresh', () => {
    it('refreshes expired token and persists new credentials', async () => {
      const expiredCalendar = {
        ...validCalendar,
        tokenExpiresAt: new Date(Date.now() - 60_000),
      };
      calendarRepo.findByUserId.mockResolvedValue(expiredCalendar);

      await service.checkAvailability(10, '2026-03-15T09:00:00', '2026-03-15T17:00:00');

      expect(calendarRepo.updateTokens).toHaveBeenCalledWith(1, expect.objectContaining({
        accessToken: 'refreshed-access',
        refreshToken: 'refreshed-refresh',
      }));
    });

    it('does not refresh a valid token', async () => {
      calendarRepo.findByUserId.mockResolvedValue(validCalendar);

      await service.checkAvailability(10, '2026-03-15T09:00:00', '2026-03-15T17:00:00');

      expect(calendarRepo.updateTokens).not.toHaveBeenCalled();
    });
  });
});
