/** Fetch user permissions from the API */
export async function fetchPermissions(userId) {
  const response = await fetch(`/api/permissions/${userId}`);
  return response.json();
}

/** Retry wrapper with exponential backoff */
export async function withRetry(fn, maxAttempts = 3) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxAttempts - 1) throw err;
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
    }
  }
}

/** Validate email format */
export function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Switch without default — structural test target
export function statusToLabel(status) {
  switch (status) {
    case 'active': return 'Active';
    case 'inactive': return 'Inactive';
    case 'pending': return 'Pending';
  }
}

// Await inside loop — structural test target
export async function processItems(items) {
  const results = [];
  for (const item of items) {
    const result = await fetch(`/api/items/${item.id}`);
    results.push(await result.json());
  }
  return results;
}
