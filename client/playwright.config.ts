import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    { command: 'npm run dev -w server', cwd: '..', url: 'http://localhost:8787/', reuseExistingServer: true, timeout: 120_000 },
    { command: 'npm run dev -w client', cwd: '..', url: 'http://localhost:5173/', reuseExistingServer: true, timeout: 120_000 },
  ],
});
