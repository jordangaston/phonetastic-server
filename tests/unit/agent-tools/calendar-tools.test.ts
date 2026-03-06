import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCalendarService, mockContainer } = vi.hoisted(() => {
  const mockCalendarService = {
    checkAvailability: vi.fn(),
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

import { createCheckAvailabilityTool, createBookAppointmentTool } from '../../../src/agent-tools/calendar-tools.js';

describe('createCheckAvailabilityTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContainer.resolve.mockReturnValue(mockCalendarService);
  });

  it('returns formatted availability with busy slots', async () => {
    mockCalendarService.checkAvailability.mockResolvedValue({
      timezone: 'America/New_York',
      busySlots: [{ start: '2026-03-15T09:00:00', end: '2026-03-15T10:00:00' }],
    });

    const tool = createCheckAvailabilityTool(10);
    const result = await tool.execute({ startDateTime: '2026-03-15T09:00:00', endDateTime: '2026-03-15T17:00:00' });

    expect(result).toEqual(expect.objectContaining({
      startDateTime: '2026-03-15T09:00:00',
      endDateTime: '2026-03-15T17:00:00',
      timezone: 'America/New_York',
      busySlots: [{ start: '2026-03-15T09:00:00', end: '2026-03-15T10:00:00' }],
    }));
    expect(result.summary).toContain('Busy times');
    expect(mockCalendarService.checkAvailability).toHaveBeenCalledWith(10, '2026-03-15T09:00:00', '2026-03-15T17:00:00');
  });

  it('returns open summary when no busy slots', async () => {
    mockCalendarService.checkAvailability.mockResolvedValue({
      timezone: 'America/New_York',
      busySlots: [],
    });

    const tool = createCheckAvailabilityTool(10);
    const result = await tool.execute({ startDateTime: '2026-03-15T09:00:00', endDateTime: '2026-03-15T17:00:00' });

    expect(result.summary).toContain('completely open');
  });

  it('returns error message on service failure', async () => {
    mockCalendarService.checkAvailability.mockRejectedValue(new Error('No calendar found for user'));

    const tool = createCheckAvailabilityTool(10);
    const result = await tool.execute({ startDateTime: '2026-03-15T09:00:00', endDateTime: '2026-03-15T17:00:00' });

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
