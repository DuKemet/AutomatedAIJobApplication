// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/playwright',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:9999',
    headless: true,
  },
});
