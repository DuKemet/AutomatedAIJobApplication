const { getDb } = require('./db');
const { v4: uuidv4 } = require('uuid');

const VALID_STATUSES = [
  'IMPORTED', 'QUEUED', 'PROCESSING', 'READY_FOR_REVIEW',
  'USER_INPUT_REQUIRED', 'BROWSER_PREPARED', 'SUBMITTED',
  'FAILED', 'SKIPPED', 'DUPLICATE', 'ALREADY_APPLIED',
  'HUMAN_ACTION_REQUIRED', 'LOGIN_REQUIRED', 'CAPTCHA_DETECTED',
];

// Legal state transitions
const ALLOWED_TRANSITIONS = {
  'IMPORTED': ['QUEUED', 'PROCESSING', 'DUPLICATE', 'ALREADY_APPLIED', 'SKIPPED', 'FAILED'],
  'QUEUED': ['PROCESSING', 'SKIPPED', 'FAILED', 'DUPLICATE', 'ALREADY_APPLIED'],
  'PROCESSING': ['READY_FOR_REVIEW', 'USER_INPUT_REQUIRED', 'BROWSER_PREPARED', 'FAILED', 'HUMAN_ACTION_REQUIRED', 'LOGIN_REQUIRED', 'CAPTCHA_DETECTED'],
  'READY_FOR_REVIEW': ['SUBMITTED', 'FAILED', 'PROCESSING'],
  'USER_INPUT_REQUIRED': ['PROCESSING', 'READY_FOR_REVIEW', 'FAILED', 'SKIPPED'],
  'BROWSER_PREPARED': ['READY_FOR_REVIEW', 'SUBMITTED', 'FAILED', 'HUMAN_ACTION_REQUIRED'],
  'FAILED': ['QUEUED', 'PROCESSING', 'SKIPPED'],
  'HUMAN_ACTION_REQUIRED': ['PROCESSING', 'READY_FOR_REVIEW', 'SUBMITTED', 'FAILED', 'SKIPPED'],
  'LOGIN_REQUIRED': ['PROCESSING', 'FAILED', 'SKIPPED'],
  'CAPTCHA_DETECTED': ['PROCESSING', 'FAILED', 'SKIPPED'],
  'SUBMITTED': [],
  'DUPLICATE': [],
  'ALREADY_APPLIED': [],
  'SKIPPED': ['QUEUED', 'PROCESSING'],
};

/**
 * Central eligibility check. Must be called before every apply/process/retry action.
 */
function checkApplicationEligibility(jobId) {
  const db = getDb();

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) {
    return { eligible: false, reason: 'JOB_NOT_FOUND' };
  }

  // Check if any fingerprint matches an already-submitted application
  const fingerprintChecks = [];

  if (job.job_id_fingerprint) {
    const match = db.prepare(`
      SELECT a.* FROM applications a
      JOIN jobs j ON a.job_id = j.id
      WHERE j.job_id_fingerprint = ? AND a.status = 'SUBMITTED' AND a.job_id != ?
    `).get(job.job_id_fingerprint, jobId);
    if (match) {
      return { eligible: false, reason: 'ALREADY_APPLIED', matched_by: 'job_id_fingerprint', matched_application_id: match.id };
    }
    fingerprintChecks.push('job_id_fingerprint');
  }

  if (job.url_fingerprint) {
    const match = db.prepare(`
      SELECT a.* FROM applications a
      JOIN jobs j ON a.job_id = j.id
      WHERE j.url_fingerprint = ? AND a.status = 'SUBMITTED' AND a.job_id != ?
    `).get(job.url_fingerprint, jobId);
    if (match) {
      return { eligible: false, reason: 'ALREADY_APPLIED', matched_by: 'url_fingerprint', matched_application_id: match.id };
    }
    fingerprintChecks.push('url_fingerprint');
  }

  if (job.company_title_fingerprint) {
    const match = db.prepare(`
      SELECT a.* FROM applications a
      JOIN jobs j ON a.job_id = j.id
      WHERE j.company_title_fingerprint = ? AND a.status = 'SUBMITTED' AND a.job_id != ?
    `).get(job.company_title_fingerprint, jobId);
    if (match) {
      return { eligible: false, reason: 'ALREADY_APPLIED', matched_by: 'company_title_fingerprint', matched_application_id: match.id };
    }
    fingerprintChecks.push('company_title_fingerprint');
  }

  // Check existing application for this job
  const existingApp = db.prepare(`
    SELECT * FROM applications WHERE job_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(jobId);

  if (existingApp) {
    if (existingApp.status === 'SUBMITTED') {
      return { eligible: false, reason: 'ALREADY_SUBMITTED', application_id: existingApp.id };
    }
    if (existingApp.status === 'PROCESSING') {
      return { eligible: false, reason: 'ALREADY_PROCESSING', application_id: existingApp.id };
    }
    if (existingApp.status === 'DUPLICATE') {
      return { eligible: false, reason: 'DUPLICATE', application_id: existingApp.id };
    }
    if (existingApp.status === 'ALREADY_APPLIED') {
      return { eligible: false, reason: 'ALREADY_APPLIED', application_id: existingApp.id };
    }
  }

  return { eligible: true, job, existing_application: existingApp };
}

/**
 * Acquire a processing lock atomically.
 */
function acquireProcessingLock(applicationId) {
  const db = getDb();
  const lockId = uuidv4();

  const result = db.prepare(`
    UPDATE applications
    SET processing_lock = ?, lock_acquired_at = datetime('now'), status = 'PROCESSING', started_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND (processing_lock IS NULL OR status NOT IN ('PROCESSING'))
      AND status NOT IN ('SUBMITTED', 'DUPLICATE', 'ALREADY_APPLIED')
  `).run(lockId, applicationId);

  if (result.changes === 0) {
    return null;
  }

  addEvent(applicationId, 'LOCK_ACQUIRED', { lock_id: lockId });
  return lockId;
}

/**
 * Release processing lock.
 */
function releaseProcessingLock(applicationId, lockId) {
  const db = getDb();
  db.prepare(`
    UPDATE applications SET processing_lock = NULL, lock_acquired_at = NULL, updated_at = datetime('now')
    WHERE id = ? AND processing_lock = ?
  `).run(applicationId, lockId);
}

/**
 * Transition application status with validation.
 */
function transitionStatus(applicationId, newStatus, extra = {}) {
  const db = getDb();
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(applicationId);
  if (!app) throw new Error('Application not found');

  // SUBMITTED can only come from explicit user confirmation
  if (newStatus === 'SUBMITTED' && !extra._userConfirmation) {
    throw new Error('SUBMITTED status requires explicit user confirmation');
  }

  const allowed = ALLOWED_TRANSITIONS[app.status];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(`Invalid transition: ${app.status} -> ${newStatus}`);
  }

  const updates = { status: newStatus, updated_at: "datetime('now')" };
  if (newStatus === 'SUBMITTED') {
    updates.submitted_at = new Date().toISOString();
    updates.submission_confirmed_by_user = 1;
  }
  if (newStatus === 'READY_FOR_REVIEW') {
    updates.reviewed_at = new Date().toISOString();
  }

  const setClauses = [];
  const values = [];
  for (const [key, val] of Object.entries(updates)) {
    if (val === "datetime('now')") {
      setClauses.push(`${key} = datetime('now')`);
    } else {
      setClauses.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (extra.error_code) { setClauses.push('error_code = ?'); values.push(extra.error_code); }
  if (extra.error_message) { setClauses.push('error_message = ?'); values.push(extra.error_message); }
  if (extra.fields_data) { setClauses.push('fields_data = ?'); values.push(JSON.stringify(extra.fields_data)); }
  if (extra.ai_analysis) { setClauses.push('ai_analysis = ?'); values.push(JSON.stringify(extra.ai_analysis)); }

  values.push(applicationId);
  db.prepare(`UPDATE applications SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

  addEvent(applicationId, 'STATUS_CHANGE', { from: app.status, to: newStatus, ...(extra.reason ? { reason: extra.reason } : {}) });

  return db.prepare('SELECT * FROM applications WHERE id = ?').get(applicationId);
}

/**
 * Add an event to application history.
 */
function addEvent(applicationId, eventType, eventData = {}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO application_events (application_id, event_type, event_data)
    VALUES (?, ?, ?)
  `).run(applicationId, eventType, JSON.stringify(eventData));
}

module.exports = {
  VALID_STATUSES,
  ALLOWED_TRANSITIONS,
  checkApplicationEligibility,
  acquireProcessingLock,
  releaseProcessingLock,
  transitionStatus,
  addEvent,
};
