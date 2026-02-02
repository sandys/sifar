import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3000',
    launchOptions: {
      args: [
        '--disable-features=BlockInsecurePrivateNetworkRequests',
        '--disable-features=PrivateNetworkAccessRespectPreflightResults',
        '--disable-features=PrivateNetworkAccess',
        '--allow-insecure-localhost',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    }
  },
  webServer: {
    command: 'node ./tests/serve-fixtures.js',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120000
  }
});
