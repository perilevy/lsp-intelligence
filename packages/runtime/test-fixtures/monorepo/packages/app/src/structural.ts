// Structural fixture for broader predicate testing

/** Switch WITHOUT default — should be found by statementLocator */
export function statusToLabel(status: string): string {
  switch (status) {
    case 'active': return 'Active';
    case 'inactive': return 'Inactive';
    case 'pending': return 'Pending';
  }
  return 'Unknown';
}

/** Switch WITH default — should NOT match switch-no-default */
export function priorityToLabel(priority: number): string {
  switch (priority) {
    case 1: return 'High';
    case 2: return 'Medium';
    default: return 'Low';
  }
}

/** Async function WITHOUT try/catch */
export async function fetchUnsafe(url: string): Promise<any> {
  const res = await fetch(url);
  return res.json();
}

/** Async function WITH try/catch */
export async function fetchSafe(url: string): Promise<any> {
  try {
    const res = await fetch(url);
    return res.json();
  } catch (err) {
    return null;
  }
}

/** Await inside loop — sequential fetch */
export async function fetchAllSequential(urls: string[]): Promise<any[]> {
  const results: any[] = [];
  for (const url of urls) {
    const res = await fetch(url);
    results.push(await res.json());
  }
  return results;
}

/** No await in loop — parallel fetch */
export async function fetchAllParallel(urls: string[]): Promise<any[]> {
  return Promise.all(urls.map((url) => fetch(url).then((r) => r.json())));
}
