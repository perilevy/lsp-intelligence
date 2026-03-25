/** Simple error handler for item operations */
export function handleItemError(error: unknown): string {
  try {
    if (error instanceof Error) {
      return `Item error: ${error.message}`;
    }
    return "Unknown item error";
  } catch (e) {
    return "Failed to handle error";
  }
}

/** Retry an async operation with backoff */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
