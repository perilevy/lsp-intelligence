export function createApiClient(baseUrl: string) {
  return { get: (path: string) => fetch(baseUrl + path) };
}

// formatResponse was removed — breaking change
export const API_VERSION = '2.0';
