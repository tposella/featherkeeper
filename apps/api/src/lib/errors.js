export class HttpError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code ?? defaultCode(statusCode);
  }
}

function defaultCode(status) {
  return (
    {
      400: 'bad_request',
      401: 'unauthorized',
      403: 'forbidden',
      404: 'not_found',
      409: 'conflict',
      413: 'too_large',
      415: 'unsupported_media_type',
      429: 'rate_limited',
      502: 'upstream_error',
      503: 'unavailable',
    }[status] ?? 'error'
  );
}

export const badRequest = (msg, code) => new HttpError(400, msg, code);
export const unauthorized = (msg = 'Sign in required') => new HttpError(401, msg);
export const forbidden = (msg = 'You do not have permission to do that') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg, code) => new HttpError(409, msg, code);

/** Postgres unique-violation -> 409 with a readable message. */
export function isUniqueViolation(err, constraint) {
  return err?.code === '23505' && (!constraint || err.constraint === constraint);
}
