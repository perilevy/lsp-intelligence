// Fixture for env-usage extraction testing

export function getApiUrl(): string {
  return process.env.API_BASE_URL ?? 'http://localhost:3000';
}

export function isFeatureEnabled(flag: string): boolean {
  return process.env.FEATURE_FLAGS?.includes(flag) ?? false;
}

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? '';
}

export const config = {
  debug: process.env.DEBUG === 'true',
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
