/**
 * Default DBOS step retry configuration for workflow steps that call external services.
 */
export const RETRY_CONFIG = {
  retriesAllowed: true,
  intervalSeconds: 10,
  maxAttempts: 5,
  backoffRate: 2,
} as const;
