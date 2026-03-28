import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 90_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true }, // share engine across tests
    },
    // Don't fail the run on unhandled rejections from LSP stream teardown.
    // The vscode-jsonrpc transport may write after the pipe is closed during
    // engine shutdown — this is a known race that doesn't affect test correctness.
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
