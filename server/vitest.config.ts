import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/setup/globalSetup.ts'],
    hookTimeout: 30_000,
    env: {
      SESSION_SECRET: 'test-secret-not-for-production-0123456789',
      DEMO_MODE: 'false',
      // Tests must never spend money: any accidental Claude call goes nowhere.
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
    },
  },
});
