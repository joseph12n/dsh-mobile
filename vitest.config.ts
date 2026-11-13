import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    env: {
      DSH_MOBILE_LOG_FILE: '0',
    },
  },
});
