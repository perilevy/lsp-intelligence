import { z } from 'zod';
import { defineTool } from '../registry.js';
import { clearWorkspaceIndex } from '../../search/index/workspaceIndex.js';

export const clearIndex = defineTool({
  name: 'clear_index',
  description:
    'Clear the in-memory workspace index. The next find_code or find_pattern call will rebuild it from scratch. Use after changing exclusion rules or when results seem stale.',
  schema: z.object({}),
  async handler(_params, _engine) {
    const { cleared, hadEntries } = clearWorkspaceIndex();
    return {
      cleared,
      previousFiles: hadEntries,
      message: hadEntries > 0
        ? `Index cleared (had ${hadEntries} files). Next query will rebuild.`
        : 'Index was already empty.',
    };
  },
});
