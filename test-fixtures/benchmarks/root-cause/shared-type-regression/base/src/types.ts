/** Render an item to a display string */
export function renderItem(item: { id: string; name: string }): string {
  return `[${item.id}] ${item.name}`;
}
