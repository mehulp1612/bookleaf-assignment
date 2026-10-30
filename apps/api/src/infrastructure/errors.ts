import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { errorResponseSchema, type ErrorCode } from '@bookleaf/contracts';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    public readonly publicMessage: string,
  ) {
    super(publicMessage);
  }
}

export function installErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    let statusCode = 500;
    let code: ErrorCode = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred.';
    let fieldErrors: Record<string, string[]> | undefined;

    if (error instanceof HttpError) {
      statusCode = error.statusCode;
      code = error.code;
      message = error.publicMessage;
    } else if (error instanceof ZodError) {
      statusCode = 400;
      code = 'VALIDATION_ERROR';
      message = 'Check the submitted fields.';
      fieldErrors = {};
      for (const issue of error.issues) {
        const key = issue.path.join('.') || '_form';
        (fieldErrors[key] ??= []).push(issue.message);
      }
    } else if (error instanceof Error && 'statusCode' in error) {
      // Framework errors must also use the public envelope, without echoing input.
      if (error.statusCode === 400) {
        statusCode = 400;
        code = 'VALIDATION_ERROR';
        message = 'The request is invalid.';
      } else if (error.statusCode === 413) {
        statusCode = 413;
        code = 'REQUEST_TOO_LARGE';
        message = 'The request is too large.';
      } else if (error.statusCode === 415) {
        statusCode = 415;
        code = 'UNSUPPORTED_MEDIA_TYPE';
        message = 'Use application/json for request bodies.';
      } else if (error.statusCode === 429) {
        statusCode = 429;
        code = 'RATE_LIMITED';
        message = 'Too many requests. Please try again later.';
      }
    }

    if (statusCode >= 500) {
      // Avoid logging raw provider/database errors, which may include credentials or query data.
      request.log.error({ code, requestId: request.id }, 'Request failed');
    }
    return reply.status(statusCode).send(
      errorResponseSchema.parse({
        error: { code, message, ...(fieldErrors ? { fieldErrors } : {}), requestId: request.id },
      }),
    );
  });
}
