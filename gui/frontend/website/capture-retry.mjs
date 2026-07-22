const TRANSIENT_CONTEXT_PATTERN = /execution context was destroyed|cannot find context with specified id|frame was detached/i

export function isTransientCaptureContextError(error) {
  const details = [error?.message, error?.cause?.message, String(error)]
    .filter(Boolean)
    .join('\n')
  return TRANSIENT_CONTEXT_PATTERN.test(details)
}

export async function withTransientCaptureRetry(operation, {
  maxAttempts = 3,
  onRetry = () => {},
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('maxAttempts must be a positive integer')
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      if (attempt === maxAttempts || !isTransientCaptureContextError(error)) throw error
      await onRetry({ error, attempt, nextAttempt: attempt + 1 })
    }
  }

  throw new Error('Capture retry loop ended unexpectedly')
}
