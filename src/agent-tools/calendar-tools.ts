import { llm } from '@livekit/agents';
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
        return formatAvailability(params, result.timezone, result.availableSlots);
      } catch (err: any) {
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
        endUserId: {
          type: 'number',
          description: 'The end user id of the caller.',
        },
        callerName: {
          type: 'string',
          description: "The caller's name, if provided.",
        },
        callerPhone: {
          type: 'string',
          description: "The caller's phone number, if provided.",
        },
      },
      required: ['summary', 'startDateTime', 'endDateTime', 'endUserId'],
    },
    execute: async (params: {
      summary: string;
      startDateTime: string;
      endDateTime: string;
      endUserId: number;
      callerName?: string;
      callerPhone?: string;
    }) => {
      try {
        const calendarService = container.resolve<CalendarService>('CalendarService');
        const description = buildDescription(params.callerName, params.callerPhone);
        const result = await calendarService.bookAppointment(userId, {
          summary: params.summary,
          description,
          startDateTime: params.startDateTime,
          endDateTime: params.endDateTime,
        });
        return {
          success: true,
          message: `Appointment booked: ${params.summary}`,
          eventId: result.eventId,
        };
      } catch (err: any) {
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

function buildDescription(callerName?: string, callerPhone?: string): string {
  const parts: string[] = ['Booked via phone call.'];
  if (callerName) parts.push(`Caller: ${callerName}`);
  if (callerPhone) parts.push(`Phone: ${callerPhone}`);
  return parts.join('\n');
}
