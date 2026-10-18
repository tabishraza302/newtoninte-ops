import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: [],
    pool: 'forks',
    // Tests share one database; parallel files would truncate each other's rows.
    fileParallelism: false,
    globalSetup: ['./tests/globalSetup.ts'],
    // Required env for modules evaluated at import time (e.g. src/config.ts).
    // Extend in later tasks; keep values in sync with .env.example.
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'mysql://newtonite:newtonite@127.0.0.1:3306/newtonite_test',
      JWT_SECRET: 'test-secret',
      // Non-default on purpose: tokens.test.ts proves the TTL is read from
      // config rather than hard-coded to the 900s default.
      ACCESS_TOKEN_TTL_SEC: '1234',
      // Mailpit is the compose container, its SMTP port published on the host.
      // The app's default points at the compose-network hostname
      // `smtp://mailpit:1025`, which does not resolve here; this tests the real send.
      SMTP_URL: 'smtp://localhost:1025',
    },
  },
})
