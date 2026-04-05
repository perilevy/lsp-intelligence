// requiredField added — breaking change for existing implementations
export interface UserConfig {
  name: string;
  email: string;
  requiredField: boolean;
}

export function createConfig(name: string, email: string): UserConfig {
  return { name, email, requiredField: false };
}
