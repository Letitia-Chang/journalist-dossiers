import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    env: {
      SESSION_SECRET: 'test-secret-not-for-production',
      // Never let a stray server/.env point the tests at a real database.
      DEMO_MODE: 'false',
    },
  },
});
