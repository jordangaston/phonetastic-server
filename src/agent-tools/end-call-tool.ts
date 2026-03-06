import { llm } from '@livekit/agents';
import { getJobContext } from '@livekit/agents';
import { container } from '../config/container.js';
import type { LiveKitService } from '../services/livekit-service.js';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a tool that ends the current call.
 *
 * @precondition The agent must be in an active LiveKit session.
 * @postcondition The caller is removed and the session shuts down.
 * @returns An LLM tool that the agent can invoke to hang up.
 */
export function createEndCallTool() {
  return llm.tool({
    description: 'Ends the call. May only be used after the caller has given consent.',
    execute: async ({}, { ctx }) => {
      const livekitService = container.resolve<LiveKitService>('LiveKitService');
      const jobCtx = getJobContext();
      const session = ctx.session;
      const room = jobCtx.room;
      const caller = await jobCtx.waitForParticipant();
      await sleep(2000);
      await livekitService.removeParticipant(room.name!, caller.identity);
      session.shutdown({ drain: true });
      await room.disconnect();
      return { success: true };
    },
  });
}
