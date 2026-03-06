import { llm } from '@livekit/agents';
import { container } from '../config/container.js';
import type { CalendarService } from '../services/calendar-service.js';

/**
 * Creates a tool that checks calendar availability for a date-time range.
 *
 * @param userId - The user whose calendar to query.
 * @returns An LLM tool the agent can invoke to check free/busy times.
 */
export function createCheckAvailabilityTool(userId: number) {
  return llm.tool({
    description:
      'Checks calendar availability for a date-time range. ' +
      'Returns busy time slots so the agent can suggest open times.',
    parameters: {
      type: 'object',
      properties: {
        timeMin: {
          type: 'string',
          description: 'Start of the range in ISO 8601 format (e.g. "2026-03-15T09:00:00").',
        },
        timeMax: {
          type: 'string',
          description: 'End of the range in ISO 8601 format (e.g. "2026-03-15T17:00:00").',
        },
      },
      required: ['timeMin', 'timeMax'],
    },
    execute: async ({ timeMin, timeMax }: { timeMin: string; timeMax: string }) => {
      try {
        const calendarService = container.resolve<CalendarService>('CalendarService');
        const result = await calendarService.checkAvailability(userId, timeMin, timeMax);
        return formatAvailability(timeMin, timeMax, result.timezone, result.busySlots);
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
  timeMin: string,
  timeMax: string,
  timezone: string,
  busySlots: Array<{ start: string; end: string }>,
): { timeMin: string; timeMax: string; timezone: string; busySlots: Array<{ start: string; end: string }>; summary: string } {
  if (busySlots.length === 0) {
    return { timeMin, timeMax, timezone, busySlots, summary: `The range ${timeMin} to ${timeMax} is completely open.` };
  }
  const slotDescriptions = busySlots.map(s => `${s.start} to ${s.end}`).join(', ');
  return {
    timeMin,
    timeMax,
    timezone,
    busySlots,
    summary: `Busy times: ${slotDescriptions}. All other times in the range are available.`,
  };
}

function buildDescription(callerName?: string, callerPhone?: string): string {
  const parts: string[] = ['Booked via phone call.'];
  if (callerName) parts.push(`Caller: ${callerName}`);
  if (callerPhone) parts.push(`Phone: ${callerPhone}`);
  return parts.join('\n');
}
