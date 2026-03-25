import { Config, ItemStatus } from "@fixtures/types";

/** Validate a config object */
export function validateConfig(config: Config): boolean {
  if (!config.projectId) return false;
  if (config.apiUrl && !config.apiUrl.startsWith("http")) return false;
  return true;
}

/** Check if a status transition is allowed */
export function isValidTransition(from: ItemStatus, to: ItemStatus): boolean {
  if (from === ItemStatus.Archived) return false;
  if (from === ItemStatus.Draft && to === ItemStatus.Archived) return false;
  return true;
}

/** Guard: can the user edit items? */
export function canEditItems(role: string): boolean {
  return role === "admin" || role === "editor";
}
