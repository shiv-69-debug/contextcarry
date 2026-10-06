import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: { browserName: 'chromium', viewport: { width: 1440, height: 1050 }, trace: 'retain-on-failure' },
  reporter: 'list',
});
