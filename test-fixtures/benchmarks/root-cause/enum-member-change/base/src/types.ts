/** Status enum for items */
export enum ItemStatus {
  Active = 'active',
  Draft = 'draft',
  Archived = 'archived',
}

/** Process an item status */
export function processStatus(status: ItemStatus): string {
  return `Status: ${status}`;
}
