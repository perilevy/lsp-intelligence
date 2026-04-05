// Added optional options parameter — non-breaking change
export function processRequest(url: string, method: string, options?: { timeout?: number; retries?: number }) {
  return { url, method, options };
}

export const API_VERSION = '1.1';
