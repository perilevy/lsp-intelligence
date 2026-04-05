import { processStatus, ItemStatus } from './types';

export function handleItem(status: ItemStatus): string {
  return processStatus(status);
}

export function handleAllStatuses(): string[] {
  return [ItemStatus.Active, ItemStatus.Draft, ItemStatus.Archived].map(processStatus);
}
