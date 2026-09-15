const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyFieldDeterministic, classifyFields, getFieldValue,
  isSubmitButton, detectCaptcha,
  SAFE_FIELD_CATEGORIES, RISKY_FIELD_CATEGORIES,
} = require('../../backend/fieldDetection');

describe('classifyFieldDeterministic', () => {
  it('classifies email by autocomplete', () => {
    const result = classifyFieldDeterministic({ autocomplete: 'email' });
    assert.equal(result.category, 'EMAIL');
    assert.ok(result.confidence >= 0.95);
  });

  it('classifies given-name by autocomplete', () => {
    const result = classifyFieldDeterministic({ autocomplete: 'given-name' });
    assert.equal(result.category, 'FIRST_NAME');
    assert.ok(result.confidence >= 0.95);
  });

  it('classifies email by input type', () => {
    const result = classifyFieldDeterministic({ type: 'email' });
    assert.equal(result.category, 'EMAIL');
    assert.ok(result.confidence >= 0.90);
  });

  it('classifies phone by input type', () => {
    const result = classifyFieldDeterministic({ type: 'tel' });
    assert.equal(result.category, 'PHONE');
    assert.ok(result.confidence >= 0.90);
  });

  it('classifies resume upload', () => {
    const result = classifyFieldDeterministic({ type: 'file', label: 'Resume / CV' });
    assert.equal(result.category, 'RESUME_UPLOAD');
    assert.ok(result.confidence >= 0.90);
  });

  it('classifies firstName by name attribute', () => {
    const result = classifyFieldDeterministic({ name: 'firstName' });
    assert.equal(result.category, 'FIRST_NAME');
    assert.ok(result.confidence >= 0.90);
  });

  it('classifies lastName by name attribute', () => {
    const result = classifyFieldDeterministic({ name: 'lastName' });
    assert.equal(result.category, 'LAST_NAME');
    assert.ok(result.confidence >= 0.90);
  });

  it('classifies linkedin by name', () => {
    const result = classifyFieldDeterministic({ name: 'linkedin' });
    assert.equal(result.category, 'LINKEDIN');
    assert.ok(result.confidence >= 0.90);
  });

  it('classifies github by name', () => {
    const result = classifyFieldDeterministic({ name: 'github' });
    assert.equal(result.category, 'GITHUB');
    assert.ok(result.confidence >= 0.90);
  });

  it('returns UNKNOWN for ambiguous field', () => {
    const result = classifyFieldDeterministic({ label: 'About you', name: 'aboutYou' });
    assert.equal(result.category, 'UNKNOWN');
    assert.ok(result.confidence < 0.5);
  });

  it('returns UNKNOWN for additional info', () => {
    const result = classifyFieldDeterministic({ label: 'Additional information', name: 'additionalInfo' });
    assert.equal(result.category, 'UNKNOWN');
    assert.ok(result.confidence < 0.5);
  });

  it('classifies salary field as risky', () => {
    const result = classifyFieldDeterministic({ label: 'Salary expectation', name: 'salary' });
    assert.equal(result.category, 'SALARY');
    assert.ok(RISKY_FIELD_CATEGORIES.includes(result.category));
  });

  it('classifies work authorization as risky', () => {
    const result = classifyFieldDeterministic({ label: 'Work authorization', name: 'workAuth' });
    assert.equal(result.category, 'WORK_AUTHORIZATION');
    assert.ok(RISKY_FIELD_CATEGORIES.includes(result.category));
  });
});

describe('classifyFields', () => {
  it('marks safe high-confidence fields as fillable', () => {
    const fields = [{ autocomplete: 'email', label: 'Email', type: 'email' }];
    const result = classifyFields(fields);
    assert.equal(result[0].fillable, true);
    assert.equal(result[0].requires_user_input, false);
  });

  it('marks risky fields as non-fillable', () => {
    const fields = [{ label: 'Salary expectation', name: 'salary' }];
    const result = classifyFields(fields);
    assert.equal(result[0].fillable, false);
  });

  it('marks unknown fields as non-fillable', () => {
    const fields = [{ label: 'About you', name: 'about' }];
    const result = classifyFields(fields);
    assert.equal(result[0].fillable, false);
  });

  it('uses AI classification when deterministic is low confidence', () => {
    const fields = [{ label: 'Your email address', name: 'custom_field_1' }];
    const aiClassifications = [{ category: 'EMAIL', confidence: 0.92, reasoning: 'email pattern' }];
    const result = classifyFields(fields, aiClassifications);
    assert.equal(result[0].field_category, 'EMAIL');
    assert.equal(result[0].source, 'ai_classification');
  });
});

describe('getFieldValue', () => {
  const profile = {
    name: 'John Doe',
    first_name: 'John',
    last_name: 'Doe',
    email: 'john@example.com',
    phone: '+1234567890',
    linkedin: 'https://linkedin.com/in/johndoe',
    github: 'https://github.com/johndoe',
    portfolio: 'https://johndoe.dev',
  };

  it('returns email', () => assert.equal(getFieldValue('EMAIL', profile), 'john@example.com'));
  it('returns first name', () => assert.equal(getFieldValue('FIRST_NAME', profile), 'John'));
  it('returns last name', () => assert.equal(getFieldValue('LAST_NAME', profile), 'Doe'));
  it('returns phone', () => assert.equal(getFieldValue('PHONE', profile), '+1234567890'));
  it('returns linkedin', () => assert.equal(getFieldValue('LINKEDIN', profile), 'https://linkedin.com/in/johndoe'));
  it('returns null for unknown category', () => assert.equal(getFieldValue('SALARY', profile), null));
  it('returns null for null profile', () => assert.equal(getFieldValue('EMAIL', null), null));
});

describe('isSubmitButton', () => {
  it('detects "Submit Application"', () => assert.ok(isSubmitButton('Submit Application')));
  it('detects "Submit"', () => assert.ok(isSubmitButton('Submit')));
  it('detects "Apply"', () => assert.ok(isSubmitButton('Apply')));
  it('detects "Apply Now"', () => assert.ok(isSubmitButton('Apply Now')));
  it('detects "Send Application"', () => assert.ok(isSubmitButton('Send Application')));
  it('detects "Complete Application"', () => assert.ok(isSubmitButton('Complete Application')));
  it('does not detect "Next"', () => assert.ok(!isSubmitButton('Next')));
  it('does not detect "Save"', () => assert.ok(!isSubmitButton('Save')));
  it('does not detect "Upload"', () => assert.ok(!isSubmitButton('Upload')));
  it('handles null', () => assert.ok(!isSubmitButton(null)));
});

describe('detectCaptcha', () => {
  it('detects reCAPTCHA', () => assert.ok(detectCaptcha('<div class="g-recaptcha">')));
  it('detects hCaptcha', () => assert.ok(detectCaptcha('<div class="h-captcha">')));
  it('detects Cloudflare', () => assert.ok(detectCaptcha('Checking if the connection is Cloudflare')));
  it('detects human verification', () => assert.ok(detectCaptcha('Please verify you are human')));
  it('does not false positive on normal content', () => assert.ok(!detectCaptcha('<form>Normal application form</form>')));
});

describe('confidence thresholds', () => {
  it('SAFE_FIELD_CATEGORIES contains expected categories', () => {
    assert.ok(SAFE_FIELD_CATEGORIES.includes('EMAIL'));
    assert.ok(SAFE_FIELD_CATEGORIES.includes('FIRST_NAME'));
    assert.ok(SAFE_FIELD_CATEGORIES.includes('LAST_NAME'));
    assert.ok(SAFE_FIELD_CATEGORIES.includes('PHONE'));
    assert.ok(SAFE_FIELD_CATEGORIES.includes('RESUME_UPLOAD'));
  });

  it('RISKY_FIELD_CATEGORIES contains expected categories', () => {
    assert.ok(RISKY_FIELD_CATEGORIES.includes('SALARY'));
    assert.ok(RISKY_FIELD_CATEGORIES.includes('WORK_AUTHORIZATION'));
    assert.ok(RISKY_FIELD_CATEGORIES.includes('UNKNOWN'));
  });

  it('safe and risky categories do not overlap', () => {
    const overlap = SAFE_FIELD_CATEGORIES.filter(c => RISKY_FIELD_CATEGORIES.includes(c));
    assert.equal(overlap.length, 0);
  });
});
