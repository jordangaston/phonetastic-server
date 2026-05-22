import { voice, log } from '@livekit/agents';
import type { CallService } from '../../services/call-service.js';
import { closeReasonToState } from '../call-state.js';

/**
 * Records the final call state when the agent session closes.
 */
export class CloseCallback {
  constructor(
    private readonly roomName: string,
    private readonly callService: CallService,
  ) {}

  async run(ev: voice.CloseEvent): Promise<void> {
    try {
      const { state, failureReason } = closeReasonToState(ev);
      log().info({ state, failureReason }, 'Session closed');
      await this.callService.onSessionClosed(this.roomName, state, failureReason);
    } catch (err) {
      log().error({ err }, 'Failed to handle session closed');
    }
  }
}
