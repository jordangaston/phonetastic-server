/**
 * Base application error with HTTP status code support.
 *
 * @param message - Human-readable error description.
 * @param statusCode - HTTP status code to return.
 * @param code - Machine-readable error code.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: number,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, code = 400) {
    super(message, 400, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, code = 404) {
    super(message, 404, code);
  }
}

export class GoneError extends AppError {
  constructor(message: string, code = 410) {
    super(message, 410, code);
  }
}

export class RateLimitError extends AppError {
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number, code = 429) {
    super(message, 429, code);
    this.retryAfter = retryAfter;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, code = 401) {
    super(message, 401, code);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 409) {
    super(message, 409, code);
  }
}

/**
 * Thrown when a user lacks permission to access a resource.
 *
 * @param message - Human-readable error description.
 * @param code - Machine-readable error code (default 403).
 */
export class ForbiddenError extends AppError {
  constructor(message: string, code = 403) {
    super(message, 403, code);
  }
}

/**
 * Thrown when an upstream service returns a server error (5xx).
 *
 * @param message - Human-readable error description.
 * @param code - Machine-readable error code (default 500).
 */
export class ServerError extends AppError {
  constructor(message: string, code = 500) {
    super(message, 500, code);
  }
}
