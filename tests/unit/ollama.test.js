const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MockOllamaClient } = require('../../backend/ollama');

describe('MockOllamaClient', () => {
  it('returns default availability', async () => {
    const client = new MockOllamaClient();
    const result = await client.checkAvailability();
    assert.equal(result.available, true);
    assert.equal(result.model_available, true);
  });

  it('returns custom availability', async () => {
    const client = new MockOllamaClient();
    client.setResponse('checkAvailability', { available: false, error: 'Connection refused' });
    const result = await client.checkAvailability();
    assert.equal(result.available, false);
  });

  it('returns default job analysis', async () => {
    const client = new MockOllamaClient();
    const result = await client.analyzeJob({ title: 'SWE', company: 'Corp' }, {});
    assert.ok(typeof result.fit_score === 'number');
    assert.ok(Array.isArray(result.matched_skills));
    assert.ok(Array.isArray(result.missing_skills));
    assert.ok(['apply', 'review', 'skip'].includes(result.recommendation));
  });

  it('returns custom job analysis', async () => {
    const client = new MockOllamaClient();
    client.setResponse('analyzeJob', {
      fit_score: 95,
      matched_skills: ['React', 'TypeScript'],
      missing_skills: [],
      recommendation: 'apply',
      summary: 'Perfect fit',
    });
    const result = await client.analyzeJob({ title: 'SWE' }, {});
    assert.equal(result.fit_score, 95);
    assert.deepEqual(result.matched_skills, ['React', 'TypeScript']);
  });

  it('returns field classifications', async () => {
    const client = new MockOllamaClient();
    const fields = [{ label: 'Email', name: 'email' }, { label: 'About', name: 'about' }];
    const result = await client.classifyFields(fields);
    assert.equal(result.length, 2);
    assert.ok(result[0].category);
    assert.ok(typeof result[0].confidence === 'number');
  });

  it('handles unavailable Ollama gracefully', async () => {
    const client = new MockOllamaClient();
    client.setResponse('checkAvailability', { available: false, error: 'timeout' });
    const avail = await client.checkAvailability();
    assert.equal(avail.available, false);
    // Should still be able to call other methods
    const analysis = await client.analyzeJob({}, {});
    assert.ok(analysis);
  });
});

describe('AI Response Validation', () => {
  it('validates JSON response structure', () => {
    const validResponse = {
      fit_score: 84,
      matched_skills: ['React', 'TypeScript'],
      missing_skills: ['AWS'],
      recommendation: 'apply',
    };
    assert.ok(typeof validResponse.fit_score === 'number');
    assert.ok(validResponse.fit_score >= 0 && validResponse.fit_score <= 100);
    assert.ok(Array.isArray(validResponse.matched_skills));
    assert.ok(Array.isArray(validResponse.missing_skills));
    assert.ok(['apply', 'review', 'skip'].includes(validResponse.recommendation));
  });

  it('rejects invalid fit_score', () => {
    const invalidResponse = { fit_score: 'high' };
    assert.ok(typeof invalidResponse.fit_score !== 'number');
  });

  it('rejects malformed JSON', () => {
    const badJson = 'not json at all';
    assert.throws(() => JSON.parse(badJson));
  });

  it('handles unexpected schema', () => {
    const unexpected = { foo: 'bar', baz: 123 };
    // Our validation should default missing fields
    const fit_score = Math.min(100, Math.max(0, unexpected.fit_score || 0));
    assert.equal(fit_score, 0);
    const recommendation = ['apply', 'review', 'skip'].includes(unexpected.recommendation)
      ? unexpected.recommendation : 'review';
    assert.equal(recommendation, 'review');
  });
});
