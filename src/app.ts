import Fastify, { type FastifyInstance } from 'fastify';
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

/**
 * Builds and configures the Fastify application instance.
 *
 * @precondition The DI container must be initialized via setupContainer().
 * @postcondition A configured Fastify instance is returned, ready to listen.
 * @param options - Optional configuration overrides.
 * @param options.logger - Whether to enable request logging. Defaults to true.
 * @param options.dbos - Whether to register DBOS workflow routes. Defaults to true.
 * @returns The configured Fastify application.
 */
export async function buildApp(options?: { logger?: boolean; dbos?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options?.logger !== false ? { level: env.LOG_LEVEL } : false,
  });

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

  if (options?.dbos !== false) {
    const { workflowController } = await import('./controllers/workflow-controller.js');
    await app.register(workflowController);
  }

  return app;
}
