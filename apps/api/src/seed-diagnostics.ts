import { ConfigurationError } from './infrastructure/config.js';
import { seedCredentialsSchema } from './modules/auth/seed.js';

export type SeedStage =
  | 'environment'
  | 'credentials'
  | 'sample data'
  | 'database connection'
  | 'password hashing'
  | 'database seed'
  | 'database cleanup';

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
  } else if (stage === 'password hashing') {
    hint =
      'Check instance memory/CPU limits and ensure the admin email differs from all sample author emails.';
  }
  // Emit only recognized codes, never arbitrary driver messages or metadata.
  const codes: Record<string, string> = {
    P1001: 'Database unreachable',
    P1002: 'Database connection timed out',
    P2002: 'Existing data violates a unique constraint',
    P2028: 'Transaction failed or timed out',
    P2034: 'Transaction conflict',
    ECONNREFUSED: 'Database connection refused',
    ETIMEDOUT: 'Database connection timed out',
    ENOTFOUND: 'Database hostname lookup failed',
    CERT_HAS_EXPIRED: 'TLS certificate expired',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS certificate is self-signed',
    SELF_SIGNED_CERT_IN_CHAIN: 'TLS certificate chain is not trusted',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS certificate cannot be verified',
    '28P01': 'Database authentication failed',
    '57014': 'Database statement timed out or was cancelled',
  };
  let current = error;
  let detail = '';
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    if (
      'code' in current &&
      typeof current.code === 'string' &&
      Object.hasOwn(codes, current.code)
    ) {
      detail += ` ${current.code}: ${codes[current.code]}.`;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return `Demo seed failed during ${stage}.${detail} ${hint} No credential values or raw errors are printed.`;
}
