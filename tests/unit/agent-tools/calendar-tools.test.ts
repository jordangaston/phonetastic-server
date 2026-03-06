import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCalendarService, mockContainer } = vi.hoisted(() => {
  const mockCalendarService = {
    getAvailability: vi.fn(),
    bookAppointment: vi.fn(),
  };
  const mockContainer = {
    resolve: vi.fn().mockReturnValue(mockCalendarService),
  };
  return { mockCalendarService, mockContainer };
});

vi.mock('../../../src/config/container.js', () => ({
  container: mockContainer,
}));

vi.mock('@livekit/agents', () => ({
  llm: {
    tool: vi.fn(({ execute }) => ({ execute })),
  },
}));

import { createGetAvailabilityTool, createBookAppointmentTool } from '../../../src/agent-tools/calendar-tools.js';

describe('createGetAvailabilityTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContainer.resolve.mockReturnValue(mockCalendarService);
  });

  it('returns available slots with summary', async () => {
    mockCalendarService.getAvailability.mockResolvedValue({
      timezone: 'America/New_York',
      availableSlots: [
        { start: '2026-03-15T10:00:00.000Z', end: '2026-03-15T10:30:00.000Z' },
        { start: '2026-03-15T11:00:00.000Z', end: '2026-03-15T11:30:00.000Z' },
      ],
    });

    const tool = createGetAvailabilityTool(10);
    const result = await tool.execute({ startDateTime: '2026-03-15T09:00:00', endDateTime: '2026-03-15T17:00:00', duration: '30m' });

    expect(result).toEqual(expect.objectContaining({
      startDateTime: '2026-03-15T09:00:00',
      endDateTime: '2026-03-15T17:00:00',
      duration: '30m',
      timezone: 'America/New_York',
      availableSlots: expect.arrayContaining([expect.objectContaining({ start: expect.any(String) })]),
    }));
    expect(result.summary).toContain('2 available 30m slots found');
    expect(mockCalendarService.getAvailability).toHaveBeenCalledWith(10, '2026-03-15T09:00:00', '2026-03-15T17:00:00', '30m');
  });

  it('returns no-slots summary when empty', async () => {
    mockCalendarService.getAvailability.mockResolvedValue({
      timezone: 'America/New_York',
      availableSlots: [],
    });

    const tool = createGetAvailabilityTool(10);
    const result = await tool.execute({ startDateTime: '2026-03-15T09:00:00', endDateTime: '2026-03-15T17:00:00', duration: '1h' });

    expect(result.summary).toBe('No available slots in the requested range.');
  });

  it('returns error message on service failure', async () => {
    mockCalendarService.getAvailability.mockRejectedValue(new Error('No calendar found for user'));

    const tool = createGetAvailabilityTool(10);
    const result = await tool.execute({ startDateTime: '2026-03-15T09:00:00', endDateTime: '2026-03-15T17:00:00', duration: '30m' });

    expect(result).toEqual({ error: 'No calendar found for user' });
  });
});

describe('createBookAppointmentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContainer.resolve.mockReturnValue(mockCalendarService);
  });

  it('books appointment and returns success', async () => {
    mockCalendarService.bookAppointment.mockResolvedValue({
      eventId: 'evt-1',
      htmlLink: 'https://cal.google.com/evt-1',
    });

    const tool = createBookAppointmentTool(10);
    const result = await tool.execute({
      summary: 'Haircut - John',
      startDateTime: '2026-03-15T14:00:00',
      endDateTime: '2026-03-15T15:00:00',
      endUserId: 42,
      callerName: 'John',
      callerPhone: '+1234567890',
    });

    expect(result).toEqual({
      success: true,
      message: 'Appointment booked: Haircut - John',
      eventId: 'evt-1',
    });
    expect(mockCalendarService.bookAppointment).toHaveBeenCalledWith(10, expect.objectContaining({
      summary: 'Haircut - John',
      description: expect.stringContaining('John'),
    }));
  });

  it('returns error message on service failure', async () => {
    mockCalendarService.bookAppointment.mockRejectedValue(new Error('Token refresh failed'));

    const tool = createBookAppointmentTool(10);
    const result = await tool.execute({
      summary: 'Haircut',
      startDateTime: '2026-03-15T14:00:00',
      endDateTime: '2026-03-15T15:00:00',
      endUserId: 42,
    });

    expect(result).toEqual({ error: 'Token refresh failed' });
  });
});
