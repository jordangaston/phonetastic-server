import { DisconnectReason } from '@livekit/rtc-node';
import { voice } from '@livekit/agents';
export type CallStateResult = { state: 'finished' | 'failed'; failureReason?: string };

/**
 * Returns true when the room name indicates a test call.
 *
 * @precondition roomName is a non-empty string.
 * @postcondition Returns true iff roomName starts with "test-".
 */
export function isTestCall(roomName: string): boolean {
  return roomName.startsWith('test-');
}

/**
 * Maps a LiveKit participant disconnect reason to a terminal call state.
 *
 * @precondition reason is a DisconnectReason enum value or undefined.
 * @postcondition Returns { state: 'failed', failureReason } for known failure
 *   reasons, and { state: 'finished' } for clean disconnects or unknown reasons.
 */
export function disconnectReasonToState(reason?: DisconnectReason): CallStateResult {
  switch (reason) {
    case DisconnectReason.USER_REJECTED: return { state: 'failed', failureReason: 'User rejected call' };
    case DisconnectReason.USER_UNAVAILABLE: return { state: 'failed', failureReason: 'User unavailable' };
    case DisconnectReason.SIP_TRUNK_FAILURE: return { state: 'failed', failureReason: 'SIP trunk failure' };
    case DisconnectReason.JOIN_FAILURE: return { state: 'failed', failureReason: 'Join failure' };
    case DisconnectReason.SIGNAL_CLOSE: return { state: 'failed', failureReason: 'Signal connection closed unexpectedly' };
    case DisconnectReason.STATE_MISMATCH: return { state: 'failed', failureReason: 'State mismatch' };
    case DisconnectReason.CONNECTION_TIMEOUT: return { state: 'failed', failureReason: 'Connection timeout' };
    case DisconnectReason.MEDIA_FAILURE: return { state: 'failed', failureReason: 'Media failure' };
    default: return { state: 'finished' };
  }
}

/**
 * Maps a LiveKit session close event to a terminal call state.
 *
 * @precondition ev is a valid voice.CloseEvent.
 * @postcondition Returns { state: 'failed', failureReason } when the session
 *   closed due to an error, and { state: 'finished' } otherwise.
 */
export function closeReasonToState(ev: voice.CloseEvent): CallStateResult {
  if (ev.reason !== voice.CloseReason.ERROR) return { state: 'finished' };
  return { state: 'failed', failureReason: getErrorMessage(ev.error) ?? 'Unknown error' };
}

function getErrorMessage(err: unknown): string | undefined {
  if (err instanceof Error) return err.message;
  return (err as { error?: Error })?.error?.message;
}
