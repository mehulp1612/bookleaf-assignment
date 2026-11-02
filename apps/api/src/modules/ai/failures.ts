export const failureMessages = {
  DISABLED: 'AI is not configured.',
  AUTHENTICATION: 'AI credentials were rejected.',
  QUOTA: 'AI quota is exhausted.',
  RATE_LIMIT: 'AI provider is rate limited.',
  TIMEOUT: 'AI request timed out.',
  CANCELLED: 'AI request was cancelled.',
  UPSTREAM: 'AI provider is unavailable.',
  INVALID_OUTPUT: 'AI output did not pass validation.',
  UNSAFE_OUTPUT: 'AI output failed grounding checks.',
  CONFIGURATION: 'AI request configuration is unsupported.',
  PERSISTENCE: 'AI run could not be recorded.',
} as const;
export type FailureCode = keyof typeof failureMessages;
export class AiFailure extends Error {
  readonly retryable: boolean;
  readonly pauseConfiguration: boolean;
  constructor(
    readonly code: FailureCode,
    readonly retryAfterMs: number | null = null,
  ) {
    super(failureMessages[code]);
    this.name = 'AiFailure';
    this.retryable = ['RATE_LIMIT', 'TIMEOUT', 'UPSTREAM'].includes(code);
    this.pauseConfiguration = ['QUOTA', 'AUTHENTICATION', 'CONFIGURATION'].includes(code);
  }
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      pauseConfiguration: this.pauseConfiguration,
      retryAfterMs: this.retryAfterMs,
    };
  }
}
