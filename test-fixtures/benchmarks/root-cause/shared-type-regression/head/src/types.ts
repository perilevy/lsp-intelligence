/** Render an item to a display string — now requires display options */
export function renderItem(item: { id: string; name: string }, options: { truncate: boolean }): string {
  const label = options.truncate ? item.name.slice(0, 20) : item.name;
  return `[${item.id}] ${label}`;
}
