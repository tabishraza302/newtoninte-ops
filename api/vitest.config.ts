import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: [],
    pool: 'forks',
    // Required env for modules evaluated at import time (e.g. src/config.ts).
    // Extend in later tasks; keep values in sync with .env.example.
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'mysql://newtonite:newtonite@127.0.0.1:3306/newtonite_test',
      JWT_SECRET: 'test-secret',
    },
  },
})
