import Fastify, { type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { env } from './config/env.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { otpController } from './controllers/otp-controller.js';
import { userController } from './controllers/user-controller.js';
import { voiceController } from './controllers/voice-controller.js';
import { botSettingsController } from './controllers/bot-settings-controller.js';
import { companyController } from './controllers/company-controller.js';
import { callController } from './controllers/call-controller.js';
import { phoneNumberController } from './controllers/phone-number-controller.js';
import { callSettingsController } from './controllers/call-settings-controller.js';
import { calendarController } from './controllers/calendar-controller.js';
import { skillController } from './controllers/skill-controller.js';
import { botSkillController } from './controllers/bot-skill-controller.js';
import { smsController } from './controllers/sms-controller.js';
import { twilioWebhookController } from './controllers/twilio-webhook-controller.js';
import { emailAddressController } from './controllers/email-address-controller.js';
import { chatController } from './controllers/chat-controller.js';
import { resendWebhookController } from './controllers/resend-webhook-controller.js';
import { subdomainController } from './controllers/subdomain-controller.js';

/**
 * Returns true when the value is a Pino Logger instance (has required logging methods).
 *
 * @param value - The value to check.
 * @returns Whether the value is a Logger instance.
 */
function isLoggerInstance(value: unknown): value is Logger {
  return typeof value === 'object' && value !== null && 'child' in value && 'info' in value;
}

/**
 * Builds Fastify constructor options for logging.
 *
 * @param option - A Pino Logger instance, a boolean, or undefined.
 * @returns Partial Fastify options with either `loggerInstance` or `logger` set.
 */
function buildLoggerOptions(option?: Logger | boolean) {
  if (isLoggerInstance(option)) return { loggerInstance: option };
  if (option === false) return { logger: false as const };
  return { logger: { level: env.LOG_LEVEL } };
}

/**
 * Builds and configures the Fastify application instance.
 *
 * @precondition The DI container must be initialized via setupContainer().
 * @postcondition A configured Fastify instance is returned, ready to listen.
 * @param options - Optional configuration overrides.
 * @param options.logger - A Pino Logger instance, `true` for default logging, or `false` to disable. Defaults to `true`.
 * @param options.dbos - Whether to register DBOS workflow routes. Defaults to true.
 * @returns The configured Fastify application.
 */
export async function buildApp(options?: { logger?: Logger | boolean; dbos?: boolean }): Promise<FastifyInstance> {
  const app = Fastify(buildLoggerOptions(options?.logger));

  registerErrorHandler(app);

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(otpController);
  await app.register(userController);
  await app.register(voiceController);
  await app.register(botSettingsController);
  await app.register(companyController);
  await app.register(callController);
  await app.register(phoneNumberController);
  await app.register(callSettingsController);
  await app.register(calendarController);
  await app.register(skillController);
  await app.register(botSkillController);
  await app.register(smsController);
  await app.register(twilioWebhookController);
  await app.register(emailAddressController);
  await app.register(chatController);
  await app.register(resendWebhookController);
  await app.register(subdomainController);

  if (options?.dbos !== false) {
    const { workflowController } = await import('./controllers/workflow-controller.js');
    await app.register(workflowController);
  }

  return app;
}
