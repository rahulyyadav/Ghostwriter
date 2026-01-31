class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

class DatabaseError extends AppError {
  constructor(message, originalError = null) {
    super(message, 500);
    this.name = 'DatabaseError';
    this.originalError = originalError;
  }
}

class LLMError extends AppError {
  constructor(message, originalError = null) {
    super(message, 500);
    this.name = 'LLMError';
    this.originalError = originalError;
  }
}

class SlackAPIError extends AppError {
  constructor(message, originalError = null) {
    super(message, 500);
    this.name = 'SlackAPIError';
    this.originalError = originalError;
  }
}

class RateLimitError extends AppError {
  constructor(message, retryAfterMs = 60000) {
    super(message, 429);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

class ImageGenerationError extends AppError {
  constructor(message, originalError = null) {
    super(message, 500);
    this.name = 'ImageGenerationError';
    this.originalError = originalError;
  }
}

module.exports = {
  AppError,
  DatabaseError,
  LLMError,
  SlackAPIError,
  RateLimitError,
  ValidationError,
  ImageGenerationError,
};
