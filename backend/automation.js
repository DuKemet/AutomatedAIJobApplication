/**
 * Browser automation layer with explicit allowlist.
 * NO generic click, NO submit, NO arbitrary JS execution.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { isSubmitButton, detectCaptcha, classifyFieldDeterministic, classifyFields, getFieldValue } = require('./fieldDetection');

// ALLOWED ACTIONS - explicit allowlist. No SUBMIT actions.
const ALLOWED_ACTIONS = [
  'NAVIGATE',
  'INSPECT_PAGE',
  'SCROLL',
  'FILL_FIELD',
  'SELECT_OPTION',
  'CHECK_CHECKBOX',
  'UPLOAD_FILE',
  'WAIT',
  'DETECT_FIELDS',
  'GET_PAGE_CONTENT',
];

// Explicitly DISALLOWED - for documentation and enforcement
const DISALLOWED_ACTIONS = [
  'SUBMIT', 'CLICK_SUBMIT', 'FINAL_SUBMIT', 'SEND_APPLICATION',
  'CONFIRM_APPLICATION', 'CLICK', 'EXECUTE_JS', 'EVALUATE',
];

class BrowserAutomation {
  constructor(profilePath) {
    this.profilePath = profilePath || process.env.BROWSER_PROFILE_PATH || './data/browser-profile';
    this.context = null;
    this.page = null;
  }

  async launch() {
    if (!fs.existsSync(this.profilePath)) {
      fs.mkdirSync(this.profilePath, { recursive: true });
    }

    this.context = await chromium.launchPersistentContext(this.profilePath, {
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
      ],
    });

    this.page = this.context.pages()[0] || await this.context.newPage();
    return this.page;
  }

  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }
  }

  /**
   * Execute an allowed action. Validates against allowlist.
   */
  async executeAction(action, params = {}) {
    if (!ALLOWED_ACTIONS.includes(action)) {
      throw new Error(`Action '${action}' is not in the allowlist. Allowed: ${ALLOWED_ACTIONS.join(', ')}`);
    }
    if (DISALLOWED_ACTIONS.includes(action)) {
      throw new Error(`Action '${action}' is explicitly disallowed for safety.`);
    }
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    switch (action) {
      case 'NAVIGATE':
        return this._navigate(params.url);
      case 'INSPECT_PAGE':
        return this._inspectPage();
      case 'SCROLL':
        return this._scroll(params.direction || 'down', params.amount || 300);
      case 'FILL_FIELD':
        return this._fillField(params.selector, params.value);
      case 'SELECT_OPTION':
        return this._selectOption(params.selector, params.value);
      case 'CHECK_CHECKBOX':
        return this._checkCheckbox(params.selector, params.checked);
      case 'UPLOAD_FILE':
        return this._uploadFile(params.selector, params.filePath);
      case 'WAIT':
        return this._wait(params.ms || 1000);
      case 'DETECT_FIELDS':
        return this._detectFields();
      case 'GET_PAGE_CONTENT':
        return this._getPageContent();
      default:
        throw new Error(`Unhandled action: ${action}`);
    }
  }

  async _navigate(url) {
    // Validate URL
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Unsafe URL scheme: ${parsed.protocol}`);
    }
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return { success: true, url: this.page.url() };
  }

  async _inspectPage() {
    const title = await this.page.title();
    const url = this.page.url();
    const content = await this.page.content();

    // Check for CAPTCHA
    if (detectCaptcha(content)) {
      return { title, url, captcha_detected: true, status: 'CAPTCHA_DETECTED' };
    }

    // Check for login requirements
    const loginIndicators = /sign.?in|log.?in|create.?account|authentication.?required/i;
    const hasLoginForm = loginIndicators.test(content) && !/<form[^>]*application/i.test(content);

    // Detect submit buttons
    const submitButtons = await this.page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a.submit-btn'));
      return buttons.map(b => ({
        text: (b.textContent || b.value || '').trim(),
        type: b.type || b.tagName.toLowerCase(),
        id: b.id,
        className: b.className,
      }));
    });

    const finalSubmitDetected = submitButtons.some(b => {
      const { isSubmitButton: isSB } = require('./fieldDetection');
      return isSB(b.text);
    });

    return {
      title,
      url,
      captcha_detected: false,
      login_required: hasLoginForm,
      final_submit_detected: finalSubmitDetected,
      submit_buttons: submitButtons,
    };
  }

  async _scroll(direction, amount) {
    const delta = direction === 'up' ? -amount : amount;
    await this.page.mouse.wheel(0, delta);
    await this.page.waitForTimeout(300);
    return { success: true };
  }

  async _fillField(selector, value) {
    // Safety: refuse to interact with submit buttons
    const el = await this.page.$(selector);
    if (!el) throw new Error(`Field not found: ${selector}`);

    const tagName = await el.evaluate(e => e.tagName.toLowerCase());
    const type = await el.evaluate(e => e.type || '');
    const text = await el.evaluate(e => (e.textContent || e.value || '').trim());

    if (tagName === 'button' || type === 'submit') {
      throw new Error('Cannot fill a button/submit element');
    }
    if (isSubmitButton(text)) {
      throw new Error('Cannot interact with a submit control');
    }

    await el.fill(value);
    return { success: true, selector, filled: true };
  }

  async _selectOption(selector, value) {
    await this.page.selectOption(selector, value);
    return { success: true, selector };
  }

  async _checkCheckbox(selector, checked = true) {
    if (checked) {
      await this.page.check(selector);
    } else {
      await this.page.uncheck(selector);
    }
    return { success: true, selector };
  }

  async _uploadFile(selector, filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const el = await this.page.$(selector);
    if (!el) throw new Error(`Upload field not found: ${selector}`);
    await el.setInputFiles(filePath);
    return { success: true, selector, file: filePath };
  }

  async _wait(ms) {
    const capped = Math.min(ms, 10000);
    await this.page.waitForTimeout(capped);
    return { success: true, waited: capped };
  }

  async _detectFields() {
    const fields = await this.page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'
      ));
      return inputs.map((el, index) => {
        // Find label
        let label = '';
        if (el.id) {
          const labelEl = document.querySelector(`label[for="${el.id}"]`);
          if (labelEl) label = labelEl.textContent.trim();
        }
        if (!label) {
          const parent = el.closest('label');
          if (parent) label = parent.textContent.trim().replace(el.value || '', '').trim();
        }
        if (!label) {
          const prev = el.previousElementSibling;
          if (prev && prev.tagName === 'LABEL') label = prev.textContent.trim();
        }

        return {
          index,
          selector: el.id ? `#${el.id}` : `[name="${el.name}"]`,
          label,
          name: el.name || '',
          id: el.id || '',
          type: el.type || el.tagName.toLowerCase(),
          placeholder: el.placeholder || '',
          autocomplete: el.getAttribute('autocomplete') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          required: el.required,
          value: el.value || '',
          tagName: el.tagName.toLowerCase(),
        };
      });
    });

    return fields;
  }

  async _getPageContent() {
    const content = await this.page.content();
    // Return a compact version, not the entire HTML
    const text = await this.page.evaluate(() => document.body?.innerText?.slice(0, 5000) || '');
    return { text, url: this.page.url(), title: await this.page.title() };
  }
}

/**
 * Run the full application preparation flow.
 * Returns fields/state but NEVER submits.
 */
async function prepareApplication(job, profile, ollamaClient, resumePath) {
  const automation = new BrowserAutomation();
  const result = {
    status: 'PROCESSING',
    fields: [],
    warnings: [],
    finalSubmitDetected: false,
  };

  try {
    await automation.launch();

    // Navigate
    const navResult = await automation.executeAction('NAVIGATE', { url: job.url || job.canonical_url });
    if (!navResult.success) throw new Error('Navigation failed');

    await automation.executeAction('WAIT', { ms: 2000 });

    // Inspect page
    const inspection = await automation.executeAction('INSPECT_PAGE');

    if (inspection.captcha_detected) {
      result.status = 'CAPTCHA_DETECTED';
      result.warnings.push('CAPTCHA detected. Manual action required.');
      return result;
    }

    if (inspection.login_required) {
      result.status = 'LOGIN_REQUIRED';
      result.warnings.push('Login required. Please log in manually in the browser profile.');
      return result;
    }

    result.finalSubmitDetected = inspection.final_submit_detected;
    if (inspection.final_submit_detected) {
      result.warnings.push('FINAL_SUBMIT_DETECTED: A submit button was found. Automation will NOT interact with it.');
    }

    // Detect fields
    const rawFields = await automation.executeAction('DETECT_FIELDS');

    // Classify fields
    let aiClassifications = null;
    if (ollamaClient) {
      try {
        const avail = await ollamaClient.checkAvailability();
        if (avail.available && avail.model_available) {
          aiClassifications = await ollamaClient.classifyFields(rawFields);
        }
      } catch { /* AI unavailable, continue without */ }
    }

    const classifiedFields = classifyFields(rawFields, aiClassifications);

    // Fill safe fields
    for (const field of classifiedFields) {
      if (field.fillable && field.confidence >= 0.85) {
        const value = getFieldValue(field.field_category, profile);
        if (value && field.selector) {
          try {
            if (field.field_category === 'RESUME_UPLOAD' && resumePath) {
              await automation.executeAction('UPLOAD_FILE', { selector: field.selector, filePath: resumePath });
              field.filled_value = resumePath;
              field.status = 'FILLED';
            } else if (field.type !== 'file') {
              await automation.executeAction('FILL_FIELD', { selector: field.selector, value });
              field.filled_value = value;
              field.status = 'FILLED';
            }
          } catch (err) {
            field.status = 'FILL_ERROR';
            field.error = err.message;
          }
        } else {
          field.status = value ? 'NO_SELECTOR' : 'NO_VALUE';
          if (!value) field.requires_user_input = true;
        }
      } else {
        field.status = field.requires_user_input ? 'REQUIRES_USER_INPUT' : 'SKIPPED';
      }
    }

    result.fields = classifiedFields;
    result.status = classifiedFields.some(f => f.requires_user_input)
      ? 'USER_INPUT_REQUIRED'
      : 'BROWSER_PREPARED';

    // Re-check for final submit as a safety gate
    const finalCheck = await automation.executeAction('INSPECT_PAGE');
    if (finalCheck.final_submit_detected) {
      result.finalSubmitDetected = true;
    }

    return result;

  } catch (error) {
    result.status = 'FAILED';
    result.error = error.message;
    result.warnings.push(`Error: ${error.message}`);
    return result;
  } finally {
    // Don't close - leave browser open for user review
    // User will manually review and submit
  }
}

module.exports = {
  ALLOWED_ACTIONS,
  DISALLOWED_ACTIONS,
  BrowserAutomation,
  prepareApplication,
};
