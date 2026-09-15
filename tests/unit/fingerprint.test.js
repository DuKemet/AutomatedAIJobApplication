const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeText, normalizeUrl, sha256,
  computeJobIdFingerprint, computeUrlFingerprint, computeCompanyTitleFingerprint,
  isUrlSafe,
} = require('../../backend/fingerprint');

describe('normalizeText', () => {
  it('trims and lowercases', () => {
    assert.equal(normalizeText('  Hello World  '), 'hello world');
  });
  it('collapses whitespace', () => {
    assert.equal(normalizeText('Hello   World'), 'hello world');
  });
  it('removes punctuation', () => {
    assert.equal(normalizeText('Hello, World!'), 'hello world');
  });
  it('handles null/undefined', () => {
    assert.equal(normalizeText(null), '');
    assert.equal(normalizeText(undefined), '');
  });
  it('handles unicode normalization', () => {
    const result = normalizeText('café');
    assert.equal(typeof result, 'string');
  });
  it('removes smart quotes', () => {
    assert.equal(normalizeText('\u201CHello\u201D'), 'hello');
  });
});

describe('normalizeUrl', () => {
  it('lowercases hostname', () => {
    const result = normalizeUrl('https://EXAMPLE.COM/jobs/123');
    assert.ok(result.includes('example.com'));
  });
  it('removes fragments', () => {
    const result = normalizeUrl('https://example.com/jobs/123#section');
    assert.ok(!result.includes('#'));
  });
  it('removes tracking parameters', () => {
    const result = normalizeUrl('https://example.com/jobs/123?utm_source=google&utm_medium=cpc');
    assert.ok(!result.includes('utm_source'));
    assert.ok(!result.includes('utm_medium'));
  });
  it('preserves meaningful query params', () => {
    const result = normalizeUrl('https://example.com/jobs?id=123');
    assert.ok(result.includes('id=123'));
  });
  it('normalizes trailing slash', () => {
    const a = normalizeUrl('https://example.com/jobs/123/');
    const b = normalizeUrl('https://example.com/jobs/123');
    assert.equal(a, b);
  });
  it('rejects file: scheme', () => {
    assert.equal(normalizeUrl('file:///etc/passwd'), null);
  });
  it('rejects javascript: scheme', () => {
    assert.equal(normalizeUrl('javascript:alert(1)'), null);
  });
  it('handles null', () => {
    assert.equal(normalizeUrl(null), null);
  });
  it('handles invalid URL', () => {
    assert.equal(normalizeUrl('not a url'), null);
  });
  it('same URL with different tracking params → same fingerprint', () => {
    const a = computeUrlFingerprint('https://example.com/jobs/123?utm_source=google');
    const b = computeUrlFingerprint('https://example.com/jobs/123?utm_source=twitter');
    assert.equal(a, b);
  });
});

describe('computeJobIdFingerprint', () => {
  it('computes fingerprint for valid job ID', () => {
    const fp = computeJobIdFingerprint('12345');
    assert.ok(fp);
    assert.equal(fp.length, 64); // SHA256 hex
  });
  it('normalizes case', () => {
    assert.equal(
      computeJobIdFingerprint('ABC123'),
      computeJobIdFingerprint('abc123')
    );
  });
  it('trims whitespace', () => {
    assert.equal(
      computeJobIdFingerprint('  123  '),
      computeJobIdFingerprint('123')
    );
  });
  it('returns null for empty/null', () => {
    assert.equal(computeJobIdFingerprint(null), null);
    assert.equal(computeJobIdFingerprint(''), null);
    assert.equal(computeJobIdFingerprint('  '), null);
  });
});

describe('computeUrlFingerprint', () => {
  it('produces consistent fingerprint', () => {
    const fp = computeUrlFingerprint('https://example.com/jobs/123');
    assert.ok(fp);
    assert.equal(fp.length, 64);
  });
  it('same URL different tracking → same fingerprint', () => {
    const a = computeUrlFingerprint('https://example.com/jobs/123?utm_source=x');
    const b = computeUrlFingerprint('https://example.com/jobs/123');
    assert.equal(a, b);
  });
  it('different path → different fingerprint', () => {
    const a = computeUrlFingerprint('https://example.com/jobs/123');
    const b = computeUrlFingerprint('https://example.com/jobs/456');
    assert.notEqual(a, b);
  });
  it('returns null for invalid URL', () => {
    assert.equal(computeUrlFingerprint('not-a-url'), null);
  });
});

describe('computeCompanyTitleFingerprint', () => {
  it('computes fingerprint', () => {
    const fp = computeCompanyTitleFingerprint('Example Corp', 'Software Engineer');
    assert.ok(fp);
    assert.equal(fp.length, 64);
  });
  it('normalizes case and whitespace', () => {
    assert.equal(
      computeCompanyTitleFingerprint('  Example Corp  ', '  Software Engineer  '),
      computeCompanyTitleFingerprint('example corp', 'software engineer')
    );
  });
  it('normalizes punctuation differences', () => {
    assert.equal(
      computeCompanyTitleFingerprint('Example, Corp.', 'Software Engineer!'),
      computeCompanyTitleFingerprint('Example Corp', 'Software Engineer')
    );
  });
  it('different company → different fingerprint', () => {
    assert.notEqual(
      computeCompanyTitleFingerprint('Company A', 'Software Engineer'),
      computeCompanyTitleFingerprint('Company B', 'Software Engineer')
    );
  });
  it('different title → different fingerprint', () => {
    assert.notEqual(
      computeCompanyTitleFingerprint('Example Corp', 'Frontend Engineer'),
      computeCompanyTitleFingerprint('Example Corp', 'Backend Engineer')
    );
  });
  it('returns null if company missing', () => {
    assert.equal(computeCompanyTitleFingerprint('', 'Title'), null);
  });
  it('returns null if title missing', () => {
    assert.equal(computeCompanyTitleFingerprint('Company', ''), null);
  });
});

describe('isUrlSafe', () => {
  it('allows http', () => assert.ok(isUrlSafe('http://example.com')));
  it('allows https', () => assert.ok(isUrlSafe('https://example.com')));
  it('rejects file:', () => assert.ok(!isUrlSafe('file:///etc/passwd')));
  it('rejects javascript:', () => assert.ok(!isUrlSafe('javascript:alert(1)')));
  it('rejects null', () => assert.ok(!isUrlSafe(null)));
  it('rejects empty', () => assert.ok(!isUrlSafe('')));
});
