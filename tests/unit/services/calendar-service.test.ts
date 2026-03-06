import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CalendarService, computeAvailableSlots } from '../../../src/services/calendar-service.js';

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
  let operationHourRepo: any;
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
    operationHourRepo = {
      findByCompanyId: vi.fn().mockResolvedValue([]),
    };
    mockClient = {
      getCalendarTimezone: vi.fn().mockResolvedValue('America/New_York'),
      queryFreeBusy: vi.fn().mockResolvedValue({ busySlots: [{ start: '2026-03-15T13:00:00Z', end: '2026-03-15T14:00:00Z' }] }),
      createEvent: vi.fn().mockResolvedValue({ eventId: 'evt-1', htmlLink: 'https://cal.google.com/evt-1' }),
    };
    service = new CalendarService(calendarRepo, operationHourRepo);
  });

  describe('getAvailability', () => {
    it('returns available slots excluding busy periods', async () => {
      calendarRepo.findByUserId.mockResolvedValue(validCalendar);

      const result = await service.getAvailability(10, '2026-03-15T12:00:00Z', '2026-03-15T15:00:00Z', '1h');

      expect(result.timezone).toBe('America/New_York');
      expect(result.availableSlots).toEqual([
        { start: '2026-03-15T12:00:00.000Z', end: '2026-03-15T13:00:00.000Z' },
        { start: '2026-03-15T14:00:00.000Z', end: '2026-03-15T15:00:00.000Z' },
      ]);
    });

    it('respects operation hours when set', async () => {
      calendarRepo.findByUserId.mockResolvedValue(validCalendar);
      mockClient.queryFreeBusy.mockResolvedValue({ busySlots: [] });
      // 2026-03-15 is a Sunday (day 0)
      operationHourRepo.findByCompanyId.mockResolvedValue([
        { dayOfWeek: 0, openTime: '09:00', closeTime: '12:00' },
      ]);

      const result = await service.getAvailability(10, '2026-03-15T08:00:00Z', '2026-03-15T14:00:00Z', '1h');

      expect(result.availableSlots).toEqual([
        { start: '2026-03-15T09:00:00.000Z', end: '2026-03-15T10:00:00.000Z' },
        { start: '2026-03-15T10:00:00.000Z', end: '2026-03-15T11:00:00.000Z' },
        { start: '2026-03-15T11:00:00.000Z', end: '2026-03-15T12:00:00.000Z' },
      ]);
    });

    it('throws when no calendar is found', async () => {
      calendarRepo.findByUserId.mockResolvedValue(undefined);

      await expect(service.getAvailability(10, '2026-03-15T09:00:00Z', '2026-03-15T17:00:00Z', '30m'))
        .rejects.toThrow('No calendar found for user');
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
      const expiredCalendar = { ...validCalendar, tokenExpiresAt: new Date(Date.now() - 60_000) };
      calendarRepo.findByUserId.mockResolvedValue(expiredCalendar);

      await service.getAvailability(10, '2026-03-15T09:00:00Z', '2026-03-15T17:00:00Z', '30m');

      expect(calendarRepo.updateTokens).toHaveBeenCalledWith(1, expect.objectContaining({
        accessToken: 'refreshed-access',
        refreshToken: 'refreshed-refresh',
      }));
    });

    it('does not refresh a valid token', async () => {
      calendarRepo.findByUserId.mockResolvedValue(validCalendar);

      await service.getAvailability(10, '2026-03-15T09:00:00Z', '2026-03-15T17:00:00Z', '30m');

      expect(calendarRepo.updateTokens).not.toHaveBeenCalled();
    });
  });
});

describe('computeAvailableSlots', () => {
  const HOUR = 60 * 60_000;

  it('returns full range when no busy slots and no operation hours', () => {
    const start = new Date('2026-03-15T09:00:00Z');
    const end = new Date('2026-03-15T12:00:00Z');
    const slots = computeAvailableSlots(start, end, [], [], HOUR);

    expect(slots).toHaveLength(3);
  });

  it('excludes busy periods', () => {
    const start = new Date('2026-03-15T09:00:00Z');
    const end = new Date('2026-03-15T12:00:00Z');
    const busy = [{ start: new Date('2026-03-15T10:00:00Z'), end: new Date('2026-03-15T11:00:00Z') }];
    const slots = computeAvailableSlots(start, end, busy, [], HOUR);

    expect(slots).toHaveLength(2);
    expect(slots[0].start).toBe('2026-03-15T09:00:00.000Z');
    expect(slots[1].start).toBe('2026-03-15T11:00:00.000Z');
  });

  it('restricts to operation hours', () => {
    const start = new Date('2026-03-15T07:00:00Z');
    const end = new Date('2026-03-15T20:00:00Z');
    // Sunday = day 0
    const opHours = [{ dayOfWeek: 0, openTime: '09:00', closeTime: '12:00' }];
    const slots = computeAvailableSlots(start, end, [], opHours, HOUR);

    expect(slots).toHaveLength(3);
    expect(slots[0].start).toBe('2026-03-15T09:00:00.000Z');
    expect(slots[2].end).toBe('2026-03-15T12:00:00.000Z');
  });

  it('returns empty when no slots fit the duration', () => {
    const start = new Date('2026-03-15T09:00:00Z');
    const end = new Date('2026-03-15T09:30:00Z');
    const slots = computeAvailableSlots(start, end, [], [], HOUR);

    expect(slots).toHaveLength(0);
  });
});
