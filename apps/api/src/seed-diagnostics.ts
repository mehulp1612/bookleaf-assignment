import { ConfigurationError } from './infrastructure/config.js';
import { seedCredentialsSchema } from './modules/auth/seed.js';

export type SeedStage = 'environment' | 'credentials' | 'sample data' | 'database seed';

export function validateSeedCredentials(values: unknown): void {
  if (!seedCredentialsSchema.safeParse(values).success) {
    throw new Error('Invalid demo credentials.');
  }
}

export function seedFailureMessage(stage: SeedStage, error: unknown): string {
  let hint =
    'Check database connectivity, TLS, migrations, timeouts, and existing identity conflicts.';
  if (stage === 'environment') {
    hint =
      'Check DATABASE_URL, APP_ORIGIN (HTTPS, no trailing slash), HOST, PORT, NODE_ENV, SESSION_TTL_SECONDS, and LOG_LEVEL.';
    if (error instanceof ConfigurationError) {
      // Only emit known field names, never the exception text or supplied values.
      const fields = [
        'DATABASE_URL',
        'APP_ORIGIN',
        'HOST',
        'PORT',
        'NODE_ENV',
        'SESSION_TTL_SECONDS',
        'LOG_LEVEL',
      ];
      hint = `Check environment fields: ${fields.filter((field) => error.message.includes(field)).join(', ') || 'invalid configuration'}. Production APP_ORIGIN must use HTTPS without a trailing slash.`;
    }
  } else if (stage === 'credentials') {
    hint =
      'Set DEMO_ADMIN_EMAIL to a valid email, DEMO_ADMIN_PASSWORD and DEMO_AUTHOR_PASSWORD to different passwords of 16–128 characters, and DEMO_RESET_PASSWORDS to true or false (or omit it).';
  } else if (stage === 'sample data') {
    hint =
      'Ensure the supplied sample JSON is committed at the repository root and contains valid JSON.';
  }
  return `Demo seed failed during ${stage}. ${hint} No credential values or raw errors are printed.`;
}
