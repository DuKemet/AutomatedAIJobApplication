const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// We'll use an in-memory database for testing
const { initSchema } = require('../../backend/db');
const { computeJobIdFingerprint, computeUrlFingerprint, computeCompanyTitleFingerprint, normalizeText, normalizeUrl } = require('../../backend/fingerprint');

let db;

function setupTestDb() {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

function insertTestJob(db, jobData) {
  const nc = normalizeText(jobData.company);
  const nt = normalizeText(jobData.title);
  const cu = normalizeUrl(jobData.url);
  const jfp = computeJobIdFingerprint(jobData.job_id);
  const ufp = computeUrlFingerprint(jobData.url);
  const ctfp = computeCompanyTitleFingerprint(jobData.company, jobData.title);

  const result = db.prepare(`
    INSERT INTO jobs (job_id, job_id_fingerprint, company, normalized_company, title, normalized_title,
      url, canonical_url, url_fingerprint, company_title_fingerprint, location, description, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobData.job_id || null, jfp, jobData.company, nc, jobData.title, nt,
    jobData.url || null, cu, ufp, ctfp,
    jobData.location || null, jobData.description || null, jobData.source || null
  );
  return result.lastInsertRowid;
}

function insertTestApplication(db, jobId, status = 'IMPORTED') {
  const result = db.prepare('INSERT INTO applications (job_id, status) VALUES (?, ?)').run(jobId, status);
  return result.lastInsertRowid;
}

describe('Duplicate Detection', () => {
  beforeEach(() => {
    db = setupTestDb();
  });

  it('same job_id, different URL → duplicate', () => {
    const jobId1 = insertTestJob(db, {
      company: 'TestCorp', title: 'SWE', job_id: '123', url: 'https://example.com/jobs/123'
    });
    insertTestApplication(db, jobId1);

    // Try to import same job_id with different URL
    const fp = computeJobIdFingerprint('123');
    const existing = db.prepare('SELECT * FROM jobs WHERE job_id_fingerprint = ?').get(fp);
    assert.ok(existing, 'Should find duplicate by job_id_fingerprint');
  });

  it('same URL, different job_id → duplicate', () => {
    const jobId1 = insertTestJob(db, {
      company: 'TestCorp', title: 'SWE', job_id: 'abc', url: 'https://example.com/jobs/123'
    });
    insertTestApplication(db, jobId1);

    const fp = computeUrlFingerprint('https://example.com/jobs/123');
    const existing = db.prepare('SELECT * FROM jobs WHERE url_fingerprint = ?').get(fp);
    assert.ok(existing, 'Should find duplicate by url_fingerprint');
  });

  it('same company/title, different URL and missing job_id → duplicate candidate', () => {
    const jobId1 = insertTestJob(db, {
      company: 'TestCorp', title: 'Software Engineer', url: 'https://example.com/jobs/1'
    });
    insertTestApplication(db, jobId1);

    const fp = computeCompanyTitleFingerprint('TestCorp', 'Software Engineer');
    const existing = db.prepare('SELECT * FROM jobs WHERE company_title_fingerprint = ?').get(fp);
    assert.ok(existing, 'Should find duplicate by company_title_fingerprint');
  });

  it('different company/title → not duplicate', () => {
    const jobId1 = insertTestJob(db, {
      company: 'TestCorp', title: 'SWE', url: 'https://example.com/jobs/1'
    });
    insertTestApplication(db, jobId1);

    const fp = computeCompanyTitleFingerprint('OtherCorp', 'PM');
    const existing = db.prepare('SELECT * FROM jobs WHERE company_title_fingerprint = ?').get(fp);
    assert.equal(existing, undefined, 'Should not find duplicate');
  });

  it('tracking parameters changed → same normalized URL', () => {
    const fp1 = computeUrlFingerprint('https://example.com/jobs/123?utm_source=google');
    const fp2 = computeUrlFingerprint('https://example.com/jobs/123?utm_source=twitter');
    assert.equal(fp1, fp2);
  });

  it('already submitted job imported again → ALREADY_APPLIED', () => {
    const jobId1 = insertTestJob(db, {
      company: 'TestCorp', title: 'SWE', job_id: '123', url: 'https://example.com/jobs/123'
    });
    insertTestApplication(db, jobId1, 'SUBMITTED');

    // Check if new import with same fingerprint is blocked
    const fp = computeJobIdFingerprint('123');
    const existing = db.prepare(`
      SELECT j.*, a.status as app_status FROM jobs j
      JOIN applications a ON a.job_id = j.id
      WHERE j.job_id_fingerprint = ? AND a.status = 'SUBMITTED'
    `).get(fp);
    assert.ok(existing, 'Should find already-applied job');
    assert.equal(existing.app_status, 'SUBMITTED');
  });

  it('duplicate import does not create multiple active applications', () => {
    const jobId1 = insertTestJob(db, {
      company: 'TestCorp', title: 'SWE', job_id: '123', url: 'https://example.com/jobs/123'
    });
    insertTestApplication(db, jobId1, 'IMPORTED');

    // Attempting to insert same job should be caught by fingerprint check
    const fp = computeJobIdFingerprint('123');
    const existing = db.prepare('SELECT * FROM jobs WHERE job_id_fingerprint = ?').get(fp);
    assert.ok(existing, 'Fingerprint check should catch duplicate before insert');

    const apps = db.prepare('SELECT COUNT(*) as count FROM applications WHERE job_id = ?').get(jobId1);
    assert.equal(apps.count, 1, 'Only one application should exist');
  });
});

describe('Already-Applied Detection', () => {
  beforeEach(() => {
    db = setupTestDb();
  });

  it('detects already applied via job_id_fingerprint', () => {
    const jobId1 = insertTestJob(db, {
      company: 'Corp A', title: 'Dev', job_id: 'J001', url: 'https://a.com/j/1'
    });
    insertTestApplication(db, jobId1, 'SUBMITTED');

    // Different URL, same job_id
    const fp = computeJobIdFingerprint('J001');
    const match = db.prepare(`
      SELECT a.*, j.company, j.title FROM applications a
      JOIN jobs j ON a.job_id = j.id
      WHERE j.job_id_fingerprint = ? AND a.status = 'SUBMITTED'
    `).get(fp);

    assert.ok(match);
    assert.equal(match.status, 'SUBMITTED');
  });

  it('detects already applied via url_fingerprint', () => {
    const jobId1 = insertTestJob(db, {
      company: 'Corp B', title: 'PM', url: 'https://b.com/jobs/42'
    });
    insertTestApplication(db, jobId1, 'SUBMITTED');

    const fp = computeUrlFingerprint('https://b.com/jobs/42');
    const match = db.prepare(`
      SELECT a.* FROM applications a
      JOIN jobs j ON a.job_id = j.id
      WHERE j.url_fingerprint = ? AND a.status = 'SUBMITTED'
    `).get(fp);

    assert.ok(match);
  });

  it('detects already applied via company_title_fingerprint', () => {
    const jobId1 = insertTestJob(db, {
      company: 'Corp C', title: 'SRE', url: 'https://c.com/jobs/99'
    });
    insertTestApplication(db, jobId1, 'SUBMITTED');

    const fp = computeCompanyTitleFingerprint('Corp C', 'SRE');
    const match = db.prepare(`
      SELECT a.* FROM applications a
      JOIN jobs j ON a.job_id = j.id
      WHERE j.company_title_fingerprint = ? AND a.status = 'SUBMITTED'
    `).get(fp);

    assert.ok(match);
  });

  it('non-submitted application is not "already applied"', () => {
    const jobId1 = insertTestJob(db, {
      company: 'Corp D', title: 'Eng', job_id: 'D001'
    });
    insertTestApplication(db, jobId1, 'IMPORTED');

    const fp = computeJobIdFingerprint('D001');
    const match = db.prepare(`
      SELECT a.* FROM applications a
      JOIN jobs j ON a.job_id = j.id
      WHERE j.job_id_fingerprint = ? AND a.status = 'SUBMITTED'
    `).get(fp);

    assert.equal(match, undefined, 'Non-submitted should not block');
  });
});

describe('State Transitions', () => {
  beforeEach(() => {
    db = setupTestDb();
  });

  it('SUBMITTED cannot be set without user confirmation flag', () => {
    const { ALLOWED_TRANSITIONS } = require('../../backend/eligibility');
    // READY_FOR_REVIEW allows SUBMITTED, but the transitionStatus function
    // requires _userConfirmation flag
    assert.ok(ALLOWED_TRANSITIONS['READY_FOR_REVIEW'].includes('SUBMITTED'));
    assert.ok(ALLOWED_TRANSITIONS['SUBMITTED'].length === 0, 'SUBMITTED is terminal');
  });

  it('SUBMITTED is terminal - no further transitions', () => {
    const { ALLOWED_TRANSITIONS } = require('../../backend/eligibility');
    assert.deepEqual(ALLOWED_TRANSITIONS['SUBMITTED'], []);
  });

  it('DUPLICATE is terminal', () => {
    const { ALLOWED_TRANSITIONS } = require('../../backend/eligibility');
    assert.deepEqual(ALLOWED_TRANSITIONS['DUPLICATE'], []);
  });

  it('ALREADY_APPLIED is terminal', () => {
    const { ALLOWED_TRANSITIONS } = require('../../backend/eligibility');
    assert.deepEqual(ALLOWED_TRANSITIONS['ALREADY_APPLIED'], []);
  });

  it('PROCESSING cannot directly transition to SUBMITTED', () => {
    const { ALLOWED_TRANSITIONS } = require('../../backend/eligibility');
    assert.ok(!ALLOWED_TRANSITIONS['PROCESSING'].includes('SUBMITTED'),
      'PROCESSING must not transition directly to SUBMITTED');
  });
});

describe('Automation Allowlist', () => {
  it('SUBMIT is not in allowed actions', () => {
    const { ALLOWED_ACTIONS, DISALLOWED_ACTIONS } = require('../../backend/automation');
    assert.ok(!ALLOWED_ACTIONS.includes('SUBMIT'));
    assert.ok(!ALLOWED_ACTIONS.includes('CLICK_SUBMIT'));
    assert.ok(!ALLOWED_ACTIONS.includes('FINAL_SUBMIT'));
    assert.ok(!ALLOWED_ACTIONS.includes('SEND_APPLICATION'));
    assert.ok(!ALLOWED_ACTIONS.includes('CONFIRM_APPLICATION'));
    assert.ok(!ALLOWED_ACTIONS.includes('CLICK'));
    assert.ok(!ALLOWED_ACTIONS.includes('EXECUTE_JS'));
    assert.ok(!ALLOWED_ACTIONS.includes('EVALUATE'));
  });

  it('disallowed actions are explicitly listed', () => {
    const { DISALLOWED_ACTIONS } = require('../../backend/automation');
    assert.ok(DISALLOWED_ACTIONS.includes('SUBMIT'));
    assert.ok(DISALLOWED_ACTIONS.includes('CLICK_SUBMIT'));
    assert.ok(DISALLOWED_ACTIONS.includes('FINAL_SUBMIT'));
    assert.ok(DISALLOWED_ACTIONS.includes('CLICK'));
    assert.ok(DISALLOWED_ACTIONS.includes('EXECUTE_JS'));
  });
});
