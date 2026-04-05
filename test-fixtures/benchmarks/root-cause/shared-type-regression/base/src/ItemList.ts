import { renderItem } from './types';

export function renderList(items: Array<{ id: string; name: string }>): string {
  return items.map((item) => renderItem({ id: item.id, name: item.name })).join('\n');
}
