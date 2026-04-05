export interface UserConfig {
  name: string;
  email: string;
}

export function createConfig(name: string, email: string): UserConfig {
  return { name, email };
}
