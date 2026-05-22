import { createHash } from 'node:crypto';
import { createLogger } from '../lib/logger.js';

/**
 * Service for sending server-side conversion events to Meta's Conversions API.
 */
export interface MetaCapiService {
  /**
   * Sends a conversion event to Meta.
   *
   * @param event - The event data to send.
   */
  sendEvent(event: MetaCapiEvent): Promise<void>;
}

export interface MetaCapiEvent {
  eventName: string;
  eventId: string;
  email: string;
  eventSourceUrl?: string;
}

const logger = createLogger('meta-capi');

export class MetaCapiServiceImpl implements MetaCapiService {
  private readonly apiUrl: string;

  constructor(
    private readonly pixelId: string,
    private readonly accessToken: string,
    private readonly defaultEventSourceUrl: string,
  ) {
    this.apiUrl = `https://graph.facebook.com/v21.0/${pixelId}/events`;
  }

  /**
   * Sends a conversion event to the Meta Conversions API.
   *
   * @precondition The event must have a valid email and event name.
   * @postcondition The event is sent to Meta; errors are logged but not thrown.
   * @param event - The conversion event data.
   */
  async sendEvent(event: MetaCapiEvent): Promise<void> {
    const hashedEmail = createHash('sha256').update(event.email.trim().toLowerCase()).digest('hex');

    const payload = {
      data: [
        {
          event_name: event.eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: event.eventId,
          action_source: 'website',
          event_source_url: event.eventSourceUrl ?? this.defaultEventSourceUrl,
          user_data: {
            em: hashedEmail,
          },
        },
      ],
      access_token: this.accessToken,
    };

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        logger.error({ status: response.status, body }, 'Meta CAPI error');
      }
    } catch (error) {
      logger.error({ err: error }, 'Meta CAPI request failed');
    }
  }
}

/**
 * Stub implementation that logs events without sending them.
 */
export class StubMetaCapiService implements MetaCapiService {
  async sendEvent(event: MetaCapiEvent): Promise<void> {
    const hashedEmail = createHash('sha256').update(event.email.trim().toLowerCase()).digest('hex');
    logger.info({ eventName: event.eventName, hashedEmail }, 'Stub: would send event');
  }
}
