import {
  type JobContext,
  type JobProcess,
  defineAgent,
  log,
  voice,
} from '@livekit/agents';
import * as livekit from '@livekit/agents-plugin-livekit';
import * as silero from '@livekit/agents-plugin-silero';
import 'dotenv/config';
import { setupContainer, container } from './config/container.js';
import type { CallService } from './services/call-service.js';
import type { LiveKitService } from './services/livekit-service.js';
import { RoomEvent, DisconnectReason } from '@livekit/rtc-node';
import { createEndCallTool } from './agent-tools/end-call-tool.js';
import { createGetAvailabilityTool, createBookAppointmentTool } from './agent-tools/calendar-tools.js';

const CARTESIA_VOICE_ID = '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc';

function isTestCall(roomName: string): boolean {
  return roomName.startsWith('test-');
}

function disconnectReasonToState(reason?: DisconnectReason): { state: 'finished' | 'failed'; failureReason?: string } {
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

function closeReasonToState(ev: voice.CloseEvent): { state: 'finished' | 'failed'; failureReason?: string } {
  if (ev.reason === voice.CloseReason.ERROR) {
    return { state: 'failed', failureReason: ev.error?.error?.message ?? 'Unknown error' };
  }
  return { state: 'finished' };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
    setupContainer();
  },
  entry: async (ctx: JobContext) => {
    const callService = container.resolve<CallService>('CallService');
    const livekitService = container.resolve<LiveKitService>('LiveKitService');
    const roomName = ctx.job.room?.name ?? '';

    ctx.room.on(RoomEvent.ParticipantDisconnected, async (participant) => {
      const { state, failureReason } = disconnectReasonToState(participant.disconnectReason);
      log().info({ state, failureReason }, 'Participant disconnected');
      await callService.onEndUserDisconnected(roomName, state, failureReason);
    });

    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: 'deepgram/nova-3',
      llm: 'openai/gpt-4o',
      tts: `cartesia/sonic:${CARTESIA_VOICE_ID}`,
      turnDetection: new livekit.turnDetector.MultilingualModel(),
    });

    let transcriptSequence = 0;
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, async (ev: voice.ConversationItemAddedEvent) => {
      const text = ev.item.textContent;
      const { role } = ev.item;
      if (text && (role === 'user' || role === 'assistant')) {
        await callService.saveTranscriptEntry(roomName, { role, text, sequenceNumber: transcriptSequence++ });
      }
    });

    session.once(voice.AgentSessionEventTypes.Close, async (ev: voice.CloseEvent) => {
      const { state, failureReason } = closeReasonToState(ev);
      log().info({ state, failureReason }, 'Session closed');
      await callService.onSessionClosed(roomName, state, failureReason);
      await livekitService.deleteRoom(roomName);
      ctx.shutdown();
    });

    session.on(voice.AgentSessionEventTypes.Error, async (ev: voice.ErrorEvent) => {
      const error: any = ev.error;
      if (error?.recoverable) {
        log().error('Recoverable error', ev.error);
      } else {
        log().error('Unrecoverable error', ev.error);
      }
    });

    const agent = new voice.Agent({
      instructions: 'You are a helpful phone assistant. Answer questions clearly and concisely.',
      tools: {
        endCall: createEndCallTool()
      }
    });
    await session.start({ agent, room: ctx.room });
    await ctx.connect();

    log().info({ roomName }, 'Call connected');

    const caller = await ctx.waitForParticipant();
    let callContext: { userId: number; companyId: number; botId: number } | undefined;
    try {
      if (isTestCall(roomName)) {
        log().info({ caller }, 'Caller found');
        await callService.onParticipantJoined(roomName);
      } else {
        log().info({ caller }, 'Caller found');
        const from = caller.attributes['sip.phoneNumber'];
        const to = caller.attributes['sip.trunkPhoneNumber'];
        log().info({ from, to }, 'Initializing inbound call');
        callContext = await callService.initializeInboundCall(roomName, from, to);
        log().info('Inbound call initialized');
      }
    } catch (err: any) {
      log().error({ err }, 'Failed to initialize inbound call');
      await session.generateReply({
        instructions: 'Inform the caller that something went wrong and to try again later.',
      }).waitForPlayout();
      await sleep(2000);
      await livekitService.removeParticipant(roomName, caller.identity);
      session.shutdown({ drain: true, reason: voice.CloseReason.ERROR });
      await ctx.room.disconnect();
      return;
    }

    log().info('Generating initial reply');
    session.generateReply({
      instructions: 'Say "Hi, I\'m Kate, your virtual assistant. How can I help you today?"',
    });
  }
});
