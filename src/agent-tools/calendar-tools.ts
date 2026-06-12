import { llm, log } from '@livekit/agents';
import { container } from '../config/container.js';
import type { CalendarService, TimeSlot } from '../services/calendar-service.js';

/**
 * Creates a tool that gets available appointment slots for a date-time range.
 *
 * @param userId - The user whose calendar to query.
 * @returns An LLM tool the agent can invoke to get available time slots.
 */
export function createGetAvailabilityTool(userId: number) {
  return llm.tool({
    description:
      'Gets available appointment slots for a date-time range. ' +
      'Returns open time slots that fit the requested duration, ' +
      'accounting for existing calendar events and business hours.',
    parameters: {
      type: 'object',
      properties: {
        startDateTime: {
          type: 'string',
          description: 'Start of the range in ISO 8601 format (e.g. "2026-03-15T09:00:00").',
        },
        endDateTime: {
          type: 'string',
          description: 'End of the range in ISO 8601 format (e.g. "2026-03-15T17:00:00").',
        },
        duration: {
          type: 'string',
          description: 'Desired appointment duration (e.g. "30m", "1h", "1h30m").',
        },
      },
      required: ['startDateTime', 'endDateTime', 'duration'],
    },
    execute: async (params: { startDateTime: string; endDateTime: string; duration: string }) => {
      try {
        const calendarService = container.resolve<CalendarService>('CalendarService');
        const result = await calendarService.getAvailability(userId, params.startDateTime, params.endDateTime, params.duration);
        const availability = formatAvailability(params, result.timezone, result.availableSlots);
        log().info({ availability }, 'Availability retrieved');
        return availability;
      } catch (err: any) {
        log().error({ err, startDateTime: params.startDateTime, endDateTime: params.endDateTime, duration: params.duration }, 'Failed to get availability');
        return { error: err.message };
      }
    },
  });
}

/**
 * Creates a tool that books an appointment on the calendar.
 *
 * @param userId - The user whose calendar to book on.
 * @returns An LLM tool the agent can invoke to create a calendar event.
 */
export function createBookAppointmentTool(userId: number) {
  return llm.tool({
    description:
      'Books an appointment on the business calendar. ' +
      'Always check availability first before booking.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Short title for the appointment (e.g. "Haircut - John").',
        },
        startDateTime: {
          type: 'string',
          description: 'Start time in ISO 8601 format (e.g. "2026-03-15T14:00:00").',
        },
        endDateTime: {
          type: 'string',
          description: 'End time in ISO 8601 format (e.g. "2026-03-15T15:00:00").',
        },
      },
      required: ['summary', 'startDateTime', 'endDateTime'],
    },
    execute: async (params: {
      summary: string;
      startDateTime: string;
      endDateTime: string;
    }) => {
      try {
        const calendarService = container.resolve<CalendarService>('CalendarService');
        const result = await calendarService.bookAppointment(userId, {
          summary: params.summary,
          startDateTime: params.startDateTime,
          endDateTime: params.endDateTime,
        });
        return {
          success: true,
          message: `Appointment booked: ${params.summary}`,
          eventId: result.eventId,
        };
      } catch (err: any) {
        log().error({ err, summary: params.summary, startDateTime: params.startDateTime, endDateTime: params.endDateTime }, 'Failed to book appointment');
        return { error: err.message };
      }
    },
  });
}

function formatAvailability(
  params: { startDateTime: string; endDateTime: string; duration: string },
  timezone: string,
  availableSlots: TimeSlot[],
) {
  if (availableSlots.length === 0) {
    return { ...params, timezone, availableSlots, summary: 'No available slots in the requested range.' };
  }
  const count = availableSlots.length;
  return {
    ...params,
    timezone,
    availableSlots,
    summary: `${count} available ${params.duration} slot${count === 1 ? '' : 's'} found.`,
  };
}

