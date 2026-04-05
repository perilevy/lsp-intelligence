/** Status enum — Archived removed, Priority added */
export enum ItemStatus {
  Active = 'active',
  Draft = 'draft',
  // Archived removed — causes TS2339 in handler.ts
}

/** Process an item status — now requires priority too */
export function processStatus(status: ItemStatus, priority: number): string {
  return `Status: ${status} (priority ${priority})`;
}
