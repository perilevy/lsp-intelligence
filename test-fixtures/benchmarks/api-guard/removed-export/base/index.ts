export function createApiClient(baseUrl: string) {
  return { get: (path: string) => fetch(baseUrl + path) };
}

export function formatResponse(data: any): string {
  return JSON.stringify(data, null, 2);
}

export const API_VERSION = '1.0';
