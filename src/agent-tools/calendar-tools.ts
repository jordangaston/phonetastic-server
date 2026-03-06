import { llm } from '@livekit/agents';
import { container } from '../config/container.js';
import type { CalendarService } from '../services/calendar-service.js';

/**
 * Creates a tool that checks calendar availability for a given date.
 *
 * @param userId - The user whose calendar to query.
 * @returns An LLM tool the agent can invoke to check free/busy times.
 */
export function createCheckAvailabilityTool(userId: number) {
  return llm.tool({
    description:
      'Checks calendar availability for a given date. ' +
      'Returns busy time slots so the agent can suggest open times.',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'The date to check in ISO format (e.g. "2026-03-15").',
        },
      },
      required: ['date'],
    },
    execute: async ({ date }: { date: string }) => {
      try {
        const calendarService = container.resolve<CalendarService>('CalendarService');
        const result = await calendarService.checkAvailability(userId, date);
        return formatAvailability(date, result.timezone, result.busySlots);
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
        callerName: {
          type: 'string',
          description: "The caller's name, if provided.",
        },
        callerPhone: {
          type: 'string',
          description: "The caller's phone number, if provided.",
        },
      },
      required: ['summary', 'startDateTime', 'endDateTime'],
    },
    execute: async (params: {
      summary: string;
      startDateTime: string;
      endDateTime: string;
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
  date: string,
  timezone: string,
  busySlots: Array<{ start: string; end: string }>,
): { date: string; timezone: string; busySlots: Array<{ start: string; end: string }>; summary: string } {
  if (busySlots.length === 0) {
    return { date, timezone, busySlots, summary: `${date} is completely open.` };
  }
  const slotDescriptions = busySlots.map(s => `${s.start} to ${s.end}`).join(', ');
  return {
    date,
    timezone,
    busySlots,
    summary: `Busy times on ${date}: ${slotDescriptions}. All other times are available.`,
  };
}

function buildDescription(callerName?: string, callerPhone?: string): string {
  const parts: string[] = ['Booked via phone call.'];
  if (callerName) parts.push(`Caller: ${callerName}`);
  if (callerPhone) parts.push(`Phone: ${callerPhone}`);
  return parts.join('\n');
}
