/** Create an HTTP client — now requires timeout in ms too */
export function createClient(baseUrl: string, timeoutMs: number): void {
  console.log(`Client created for ${baseUrl} with ${timeoutMs}ms timeout`);
}
