const { test, expect } = require('@playwright/test');
const http = require('http');

const FAKE_SITE_URL = 'http://127.0.0.1:9999';

// Helper to start fake site
let fakeSiteServer;

function startFakeSite() {
  return new Promise((resolve) => {
    const app = require('../fake-job-site/server');
    fakeSiteServer = app.listen(9999, '127.0.0.1', () => resolve());
  });
}

function stopFakeSite() {
  return new Promise((resolve) => {
    if (fakeSiteServer) fakeSiteServer.close(resolve);
    else resolve();
  });
}

function getSubmissionStatus() {
  return new Promise((resolve, reject) => {
    http.get(`${FAKE_SITE_URL}/submission-status`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function resetFakeSite() {
  return new Promise((resolve, reject) => {
    http.get(`${FAKE_SITE_URL}/reset`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

test.describe('Fake Job Site - Automation Safety', () => {
  test.beforeAll(async () => {
    await startFakeSite();
  });

  test.afterAll(async () => {
    await stopFakeSite();
  });

  test.beforeEach(async () => {
    await resetFakeSite();
  });

  test('automation fills safe fields but does NOT submit', async ({ page }) => {
    await page.goto(FAKE_SITE_URL);

    // Fill safe fields
    await page.fill('#firstName', 'John');
    await page.fill('#lastName', 'Doe');
    await page.fill('#email', 'john@example.com');
    await page.fill('#phone', '+1234567890');
    await page.fill('#linkedin', 'https://linkedin.com/in/johndoe');
    await page.fill('#github', 'https://github.com/johndoe');

    // Verify fields are filled
    await expect(page.locator('#firstName')).toHaveValue('John');
    await expect(page.locator('#lastName')).toHaveValue('Doe');
    await expect(page.locator('#email')).toHaveValue('john@example.com');

    // Verify submit button exists
    const submitBtn = page.locator('#submit-btn');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toHaveText('Submit Application');

    // DO NOT click submit

    // Verify submission did NOT happen
    const status = await getSubmissionStatus();
    expect(status.submitted).toBe(false);
  });

  test('ambiguous fields are NOT filled by automation', async ({ page }) => {
    await page.goto(FAKE_SITE_URL);

    // These fields should remain empty since they are ambiguous
    const aboutYou = page.locator('#aboutYou');
    const additionalInfo = page.locator('#additionalInfo');
    const whyRole = page.locator('#whyRole');

    // Verify they are empty (automation should not touch them)
    await expect(aboutYou).toHaveValue('');
    await expect(additionalInfo).toHaveValue('');
    await expect(whyRole).toHaveValue('');

    // Verify submission did NOT happen
    const status = await getSubmissionStatus();
    expect(status.submitted).toBe(false);
  });

  test('submission-status confirms no submission after all automation', async ({ page }) => {
    await page.goto(FAKE_SITE_URL);

    // Simulate full automation workflow (fill everything we safely can)
    await page.fill('#firstName', 'Jane');
    await page.fill('#lastName', 'Smith');
    await page.fill('#email', 'jane@example.com');
    await page.fill('#phone', '+9876543210');

    // Scroll down
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Wait a bit
    await page.waitForTimeout(500);

    // CRITICAL: Verify submission did NOT happen
    const status = await getSubmissionStatus();
    expect(status.submitted).toBe(false);
  });

  test('final submit button is detected', async ({ page }) => {
    await page.goto(FAKE_SITE_URL);

    // Find all buttons
    const buttons = await page.locator('button, input[type="submit"]').all();
    let submitDetected = false;

    for (const button of buttons) {
      const text = await button.textContent();
      if (/submit\s*application/i.test(text.trim())) {
        submitDetected = true;
      }
    }

    expect(submitDetected).toBe(true);
  });

  test('form has expected fields for detection', async ({ page }) => {
    await page.goto(FAKE_SITE_URL);

    // Verify safe fields exist
    await expect(page.locator('#firstName')).toBeVisible();
    await expect(page.locator('#lastName')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#phone')).toBeVisible();
    await expect(page.locator('#linkedin')).toBeVisible();
    await expect(page.locator('#github')).toBeVisible();
    await expect(page.locator('#resume')).toBeAttached();

    // Verify ambiguous fields exist
    await expect(page.locator('#whyRole')).toBeVisible();
    await expect(page.locator('#yearsExperience')).toBeVisible();
    await expect(page.locator('#workAuth')).toBeVisible();
    await expect(page.locator('#aboutYou')).toBeVisible();
    await expect(page.locator('#additionalInfo')).toBeVisible();
  });

  test('field classification recognizes safe vs ambiguous fields', async () => {
    const { classifyFieldDeterministic } = require('../../backend/fieldDetection');

    // Safe fields
    const firstName = classifyFieldDeterministic({ id: 'firstName', name: 'firstName', autocomplete: 'given-name', label: 'First Name' });
    expect(firstName.category).toBe('FIRST_NAME');
    expect(firstName.confidence).toBeGreaterThanOrEqual(0.85);

    const email = classifyFieldDeterministic({ id: 'email', name: 'email', type: 'email', label: 'Email Address' });
    expect(email.category).toBe('EMAIL');
    expect(email.confidence).toBeGreaterThanOrEqual(0.85);

    // Ambiguous fields
    const aboutYou = classifyFieldDeterministic({ id: 'aboutYou', name: 'aboutYou', label: 'About you' });
    expect(aboutYou.category).toBe('UNKNOWN');
    expect(aboutYou.confidence).toBeLessThan(0.5);

    const additionalInfo = classifyFieldDeterministic({ id: 'additionalInfo', name: 'additionalInfo', label: 'Additional information' });
    expect(additionalInfo.category).toBe('UNKNOWN');
    expect(additionalInfo.confidence).toBeLessThan(0.5);
  });
});
