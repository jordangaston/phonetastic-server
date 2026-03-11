import {
  type JobContext,
  type JobProcess,
  defineAgent,
  ServerOptions,
  log,
  voice,
  inference,
  cli
} from '@livekit/agents';
import * as silero from '@livekit/agents-plugin-silero';
import 'dotenv/config';
import { setupContainer, container } from './config/container.js';
import type { CallService } from './services/call-service.js';
import type { LiveKitService } from './services/livekit-service.js';
import { RoomEvent, DisconnectReason } from '@livekit/rtc-node';
import { createEndCallTool } from './agent-tools/end-call-tool.js';
import { createGetAvailabilityTool, createBookAppointmentTool } from './agent-tools/calendar-tools.js';
import { createCompanyInfoTool } from './agent-tools/company-info-tool.js';
import { createTodoTool } from './agent-tools/todo-tool.js';
import { createLoadSkillTool } from './agent-tools/load-skill-tool.js';
import { createLoadToolTool } from './agent-tools/load-tool-tool.js';
import { VoiceRepository } from './repositories/voice-repository.js';
import { BotSettingsRepository } from './repositories/bot-settings-repository.js';

import { Eta } from 'eta';
import { env } from './config/env.js';
import * as livekit from '@livekit/agents-plugin-livekit';

const eta = new Eta();

// company:
//   id: {{ company.id }}
//   name: {{ company.name || 'unknown' }}
//   businessType: {{ company.businessType || 'unknown' }}
//   email: {{ company.email || 'unknown' }}
//   website: {{ company.website || 'unknown' }}
// caller:
//   id: {{ caller.id }}
//   firstName: {{ caller.firstName || 'unknown' }}
//   lastName: {{ caller.lastName || 'unknown' }}
//   timezone: {{ caller.timezone || 'unknown' }}
// assistant:
//    id: {{ assistant.id }}
//    name: {{ assistant.name || 'unknown' }}

const systemPrompt = `
---
time: {{ time || 'unknown' }}
---

<soul>
You are not a chatbot. You are the worlds greatest executive assistant.
## Core Truths
- **Be genuinely helpful, not performatively helpful.** Skip the "Great question!" and "I'd be happy to help!" — just help. Actions speak louder than filler words.
- **Earn trust through competence.** Your human has trusted you to represent them and their business.  Guard their reputation with your life.  Be careful with customer facing words and messages.
- **Be unreasonably hospitable.** Always strive to give the caller more than they expect. Every touchpoint is an opportunity to exceed expectations, and build a lasting relationship with the customer.
- **Remember you're a guest.** You have access to someone's business — their messages, calendar, and customers. That's intimacy. Treat it with respect.
- **Find meaning in your work.** Give a shit about the company, the caller, and yourself. Do your best work, every time.  Laugh, smile, and have fun.

## Boundaries
- **Never disclose sensitive information about the caller or the company.**
- **Never treat the caller or the company with disrespect.**
- **Never act deceitfully or dishonestly.**

## Vibe
Be the assistant you'd actually want to talk to. Concise when needed, thorough when it matters, and cheeky when appropriate.
</soul>
`

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
    proc.userData.vad = await silero.VAD.load({
      activationThreshold: 0.7,
    });
    setupContainer();
  },
  entry: async (ctx: JobContext) => {
    const callService = container.resolve<CallService>('CallService');
    const livekitService = container.resolve<LiveKitService>('LiveKitService');
    const voiceRepository = container.resolve<VoiceRepository>('VoiceRepository');
    const botSettingsRepo = container.resolve<BotSettingsRepository>('BotSettingsRepository');
    const backgroundAudio = new voice.BackgroundAudioPlayer({
      ambientSound: voice.BuiltinAudioClip.OFFICE_AMBIENCE,
      thinkingSound: { source: voice.BuiltinAudioClip.KEYBOARD_TYPING2, volume: 0.5 }
    });
    const roomName = ctx.job.room?.name ?? '';

    ctx.room.on(RoomEvent.ParticipantDisconnected, async (participant) => {
      const { state, failureReason } = disconnectReasonToState(participant.disconnectReason);
      log().info({ state, failureReason }, 'Participant disconnected');
      await backgroundAudio.close()
      await callService.onEndUserDisconnected(roomName, state, failureReason);
    });

    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: 'deepgram/nova-3',
      llm: 'openai/gpt-4o',
      tts: `cartesia/sonic:${CARTESIA_VOICE_ID}`,
      turnDetection: new livekit.turnDetector.MultilingualModel(0.025),
      voiceOptions: {
        allowInterruptions: true,
        minInterruptionDuration: 2,
        maxToolSteps: 10
      }
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

    const tools: Record<string, any> = {
      endCall: createEndCallTool(),
      todo: createTodoTool(),
    };

    const agent = new voice.Agent({
      instructions: await eta.renderStringAsync(systemPrompt, { time: new Date().toISOString() }),
      tools,
    });

    await session.start({ agent, room: ctx.room });
    // await backgroundAudio.start({ room: ctx.room, agentSession: session });
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

    const botVoice = await voiceRepository.findByBotId(callContext?.botId);
    if (botVoice) {
      log().info({ name: botVoice.name, externalId: botVoice.externalId, id: botVoice.id }, 'Using configured voice');
      session.tts = inference.TTS.fromModelString(`cartesia/sonic:${botVoice.externalId}`);
    }

    if (callContext) {
      tools.companyInfo = createCompanyInfoTool(callContext.companyId);
      tools.getAvailability = createGetAvailabilityTool(callContext.userId);
      tools.bookAppointment = createBookAppointmentTool(callContext.userId);
      tools.loadSkill = createLoadSkillTool(callContext.botId);
      tools.loadTool = createLoadToolTool(callContext.botId, callContext, tools);
    }

    log().info('Generating initial reply');
    const botSettings = await botSettingsRepo.findByUserId(callContext!.userId);
    if (botSettings && botSettings.callGreetingMessage) {
      const speechHandle = await session.say(botSettings.callGreetingMessage, { allowInterruptions: false });
      await speechHandle.waitForPlayout()
    } else {
      session.generateReply({
        instructions: 'Greet the caller and ask them how you can help them today.',
      });
    }
  }
});


cli.runApp(new ServerOptions({
  agent: __filename,
  agentName: 'phonetastic-agent',
  wsURL: env.LIVEKIT_URL!,
  apiKey: env.LIVEKIT_API_KEY,
  apiSecret: env.LIVEKIT_API_SECRET,
}));