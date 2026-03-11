import { createCompanyInfoTool } from './company-info-tool.js';
import { createGetAvailabilityTool, createBookAppointmentTool } from './calendar-tools.js';

/**
 * Context required to construct dynamically-loaded tools.
 *
 * @param companyId - The company associated with the current call.
 * @param userId - The user (business owner) associated with the current call.
 * @param botId - The bot handling the current call.
 */
export interface ToolContext {
  companyId: number;
  userId: number;
  botId: number;
}

/** A factory that produces an LLM tool given the current call context. */
export type ToolFactory = (ctx: ToolContext) => unknown;

/**
 * Registry of tools that can be dynamically loaded by the agent at runtime.
 *
 * Only tools that are context-dependent and not always loaded belong here.
 * Meta-tools (loadSkill, loadTool) and always-on tools (endCall, todo) are
 * excluded because they are registered unconditionally.
 *
 * @precondition Each key must match the name used in skill `allowed_tools`.
 * @postcondition Calling a factory returns a fully configured LLM tool.
 */
export const toolRegistry: Record<string, ToolFactory> = {
  companyInfo: (ctx) => createCompanyInfoTool(ctx.companyId),
  getAvailability: (ctx) => createGetAvailabilityTool(ctx.userId),
  bookAppointment: (ctx) => createBookAppointmentTool(ctx.userId),
};
