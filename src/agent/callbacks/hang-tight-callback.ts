import { voice, log } from '@livekit/agents';
import type { SessionData } from '../../agent.js';

const DEFAULT_DELAY_MS = 1000;

const ACKNOWLEDGE_INSTRUCTIONS =
  "Say something brief and natural to let the caller know you're working on their request. " +
  'One sentence. Use a dash for a natural pause. Contractions always. Positive and upbeat. ' +
  'Examples: "One sec—" / "Let me look into that—" / "Bear with me a moment—" / "On it—" ' +
  'Never say "Great question!" or "Certainly!" or "Absolutely!"';

/**
 * Starts a timer when the agent enters the thinking state. If the agent has
 * not begun speaking within delayMs, speaks a brief acknowledgment phrase so
 * the caller does not experience silence.
 *
 * @precondition session is an active AgentSession.
 * @postcondition At most one acknowledgment phrase plays per thinking period.
 * @param session - The active AgentSession to speak through.
 * @param delayMs - Milliseconds to wait before acknowledging. Defaults to 1000.
 */
export class HangTightCallback {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly session: voice.AgentSession<SessionData>,
    private readonly delayMs: number = DEFAULT_DELAY_MS,
  ) { }

  run(ev: voice.AgentStateChangedEvent): void {
    if (ev.newState === 'thinking') {
      this.startTimer();
    } else if (ev.newState === 'speaking') {
      this.cancelTimer();
    }
  }

  /**
   * Cancels any pending timer. Call on session close to prevent
   * generateReply from being called on a closed session.
   */
  cancel(): void {
    this.cancelTimer();
  }

  private startTimer(): void {
    this.cancelTimer();
    this.timer = setTimeout(() => void this.onTimerFired(), this.delayMs);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async onTimerFired(): Promise<void> {
    this.timer = null;
    try {
      await this.session.generateReply({ instructions: ACKNOWLEDGE_INSTRUCTIONS }).waitForPlayout();
      log().info('HangTightCallback: acknowledgment phrase played');
    } catch (err: any) {
      log().warn({ err }, 'HangTightCallback: generateReply failed');
    }
  }
}
