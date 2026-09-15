const express = require('express');
const { getDb } = require('./db');
const { computeJobIdFingerprint, computeUrlFingerprint, computeCompanyTitleFingerprint, normalizeText, normalizeUrl, isUrlSafe } = require('./fingerprint');
const { checkApplicationEligibility, acquireProcessingLock, releaseProcessingLock, transitionStatus, addEvent } = require('./eligibility');
const { OllamaClient } = require('./ollama');
const { prepareApplication } = require('./automation');
const path = require('path');

const router = express.Router();

// ─── Health ─────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  const ollama = new OllamaClient();
  const ollamaStatus = await ollama.checkAvailability();
  res.json({
    status: 'ok',
    database: true,
    ollama: ollamaStatus,
    timestamp: new Date().toISOString(),
  });
});

// ─── Jobs ───────────────────────────────────────────────────────
router.get('/jobs', (req, res) => {
  const db = getDb();
  const jobs = db.prepare(`
    SELECT j.*, a.status as application_status, a.id as application_id
    FROM jobs j
    LEFT JOIN applications a ON a.job_id = j.id
    ORDER BY j.created_at DESC
  `).all();
  res.json(jobs);
});

router.get('/jobs/:id', (req, res) => {
  const db = getDb();
  const job = db.prepare(`
    SELECT j.*, a.status as application_status, a.id as application_id
    FROM jobs j
    LEFT JOIN applications a ON a.job_id = j.id
    WHERE j.id = ?
  `).get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.post('/jobs/import', (req, res) => {
  const db = getDb();
  let jobs;

  try {
    jobs = Array.isArray(req.body) ? req.body : [req.body];
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const results = {
    imported: 0,
    duplicates: 0,
    already_applied: 0,
    invalid: 0,
    details: [],
  };

  const insertJob = db.prepare(`
    INSERT INTO jobs (job_id, job_id_fingerprint, company, normalized_company, title, normalized_title,
      url, canonical_url, url_fingerprint, company_title_fingerprint, location, description, requirements,
      salary, remote, source, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertApp = db.prepare(`
    INSERT INTO applications (job_id, status) VALUES (?, ?)
  `);

  const insertEvent = db.prepare(`
    INSERT INTO application_events (application_id, event_type, event_data) VALUES (?, ?, ?)
  `);

  const importTransaction = db.transaction((jobList) => {
    for (const jobData of jobList) {
      // Validate
      if (!jobData.title || !jobData.company) {
        results.invalid++;
        results.details.push({ company: jobData.company, title: jobData.title, status: 'INVALID', reason: 'Missing title or company' });
        continue;
      }

      if (jobData.url && !isUrlSafe(jobData.url)) {
        results.invalid++;
        results.details.push({ company: jobData.company, title: jobData.title, status: 'INVALID', reason: 'Unsafe URL' });
        continue;
      }

      // Calculate fingerprints
      const normalizedCompany = normalizeText(jobData.company);
      const normalizedTitle = normalizeText(jobData.title);
      const canonicalUrl = normalizeUrl(jobData.url);

      const jobIdFp = computeJobIdFingerprint(jobData.job_id);
      const urlFp = computeUrlFingerprint(jobData.url);
      const ctFp = computeCompanyTitleFingerprint(jobData.company, jobData.title);

      // Check duplicates
      let isDuplicate = false;
      let matchedBy = null;
      let isAlreadyApplied = false;

      if (jobIdFp) {
        const existing = db.prepare('SELECT j.*, a.status as app_status FROM jobs j LEFT JOIN applications a ON a.job_id = j.id WHERE j.job_id_fingerprint = ?').get(jobIdFp);
        if (existing) {
          isDuplicate = true;
          matchedBy = 'job_id_fingerprint';
          if (existing.app_status === 'SUBMITTED') isAlreadyApplied = true;
        }
      }

      if (!isDuplicate && urlFp) {
        const existing = db.prepare('SELECT j.*, a.status as app_status FROM jobs j LEFT JOIN applications a ON a.job_id = j.id WHERE j.url_fingerprint = ?').get(urlFp);
        if (existing) {
          isDuplicate = true;
          matchedBy = 'url_fingerprint';
          if (existing.app_status === 'SUBMITTED') isAlreadyApplied = true;
        }
      }

      if (!isDuplicate && ctFp) {
        const existing = db.prepare('SELECT j.*, a.status as app_status FROM jobs j LEFT JOIN applications a ON a.job_id = j.id WHERE j.company_title_fingerprint = ?').get(ctFp);
        if (existing) {
          isDuplicate = true;
          matchedBy = 'company_title_fingerprint';
          if (existing.app_status === 'SUBMITTED') isAlreadyApplied = true;
        }
      }

      if (isAlreadyApplied) {
        results.already_applied++;
        results.details.push({
          company: jobData.company,
          title: jobData.title,
          status: 'ALREADY_APPLIED',
          matched_by: matchedBy,
        });
        continue;
      }

      if (isDuplicate) {
        results.duplicates++;
        results.details.push({
          company: jobData.company,
          title: jobData.title,
          status: 'DUPLICATE',
          matched_by: matchedBy,
        });
        continue;
      }

      // Insert job
      const jobResult = insertJob.run(
        jobData.job_id || null,
        jobIdFp,
        jobData.company,
        normalizedCompany,
        jobData.title,
        normalizedTitle,
        jobData.url || null,
        canonicalUrl,
        urlFp,
        ctFp,
        jobData.location || null,
        jobData.description || null,
        JSON.stringify(jobData.requirements || []),
        jobData.salary || null,
        jobData.remote ? 1 : 0,
        jobData.source || null,
        JSON.stringify(jobData),
      );

      // Create application
      const appResult = insertApp.run(jobResult.lastInsertRowid, 'IMPORTED');
      insertEvent.run(appResult.lastInsertRowid, 'IMPORTED', JSON.stringify({ source: jobData.source || 'import' }));

      results.imported++;
      results.details.push({
        company: jobData.company,
        title: jobData.title,
        status: 'IMPORTED',
        job_id: jobResult.lastInsertRowid,
      });
    }
  });

  try {
    importTransaction(jobs);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Applications ───────────────────────────────────────────────
router.get('/applications', (req, res) => {
  const db = getDb();
  const apps = db.prepare(`
    SELECT a.*, j.company, j.title, j.location, j.url, j.canonical_url, j.source
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
    ORDER BY a.created_at DESC
  `).all();
  res.json(apps);
});

router.get('/applications/:id', (req, res) => {
  const db = getDb();
  const app = db.prepare(`
    SELECT a.*, j.company, j.title, j.location, j.url, j.canonical_url, j.description, j.requirements, j.source, j.remote
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
    WHERE a.id = ?
  `).get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  const events = db.prepare('SELECT * FROM application_events WHERE application_id = ? ORDER BY created_at ASC').all(req.params.id);
  const fields = db.prepare('SELECT * FROM application_fields WHERE application_id = ?').all(req.params.id);

  res.json({ ...app, events, fields });
});

router.get('/applications/:id/review', (req, res) => {
  const db = getDb();
  const app = db.prepare(`
    SELECT a.*, j.company, j.title, j.location, j.url, j.canonical_url, j.description, j.requirements, j.source, j.remote,
           j.job_id as external_job_id
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
    WHERE a.id = ?
  `).get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  const fields = db.prepare('SELECT * FROM application_fields WHERE application_id = ?').all(req.params.id);
  const events = db.prepare('SELECT * FROM application_events WHERE application_id = ? ORDER BY created_at ASC').all(req.params.id);

  let aiAnalysis = null;
  try { aiAnalysis = app.ai_analysis ? JSON.parse(app.ai_analysis) : null; } catch {}

  let fieldsData = null;
  try { fieldsData = app.fields_data ? JSON.parse(app.fields_data) : null; } catch {}

  res.json({
    job: {
      id: app.job_id,
      company: app.company,
      title: app.title,
      location: app.location,
      url: app.url,
      canonical_url: app.canonical_url,
      description: app.description,
      requirements: app.requirements,
      source: app.source,
      remote: app.remote,
      external_job_id: app.external_job_id,
    },
    application: {
      id: app.id,
      status: app.status,
      created_at: app.created_at,
      updated_at: app.updated_at,
      started_at: app.started_at,
      reviewed_at: app.reviewed_at,
      submitted_at: app.submitted_at,
      submission_confirmed_by_user: app.submission_confirmed_by_user,
      error_code: app.error_code,
      error_message: app.error_message,
    },
    fields: fieldsData || fields,
    ai_analysis: aiAnalysis,
    events,
    warnings: [],
  });
});

// Process application
router.post('/applications/:id/process', async (req, res) => {
  const db = getDb();
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  // Central eligibility check
  const eligibility = checkApplicationEligibility(app.job_id);
  if (!eligibility.eligible) {
    return res.status(409).json({ error: 'Not eligible', ...eligibility });
  }

  // Acquire lock atomically
  const lockId = acquireProcessingLock(app.id);
  if (!lockId) {
    return res.status(409).json({ error: 'Could not acquire processing lock. Application may already be processing.' });
  }

  try {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(app.job_id);

    // AI analysis (optional)
    const ollama = new OllamaClient();
    let aiAnalysis = null;
    try {
      const avail = await ollama.checkAvailability();
      if (avail.available && avail.model_available) {
        const profile = db.prepare('SELECT * FROM candidate_profile WHERE id = 1').get();
        let profileData = {};
        try {
          profileData = {
            ...profile,
            skills: profile.skills ? JSON.parse(profile.skills) : [],
            education: profile.education ? JSON.parse(profile.education) : [],
            experience: profile.experience ? JSON.parse(profile.experience) : [],
          };
        } catch {}
        aiAnalysis = await ollama.analyzeJob(job, profileData);
      }
    } catch {}

    // Browser automation
    const profile = db.prepare('SELECT * FROM candidate_profile WHERE id = 1').get();
    let profileData = {};
    try {
      profileData = {
        ...profile,
        skills: profile.skills ? JSON.parse(profile.skills) : [],
      };
    } catch {}

    const resumePath = process.env.RESUME_PATH || null;

    if (job.url || job.canonical_url) {
      const automationResult = await prepareApplication(job, profileData, ollama, resumePath);

      // Save fields
      if (automationResult.fields && automationResult.fields.length > 0) {
        const insertField = db.prepare(`
          INSERT INTO application_fields (application_id, field_selector, field_label, field_type, field_category,
            detected_value, filled_value, confidence, source, status, requires_user_input)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const f of automationResult.fields) {
          insertField.run(
            app.id,
            f.selector || null,
            f.label || null,
            f.type || null,
            f.field_category || 'UNKNOWN',
            f.value || null,
            f.filled_value || null,
            f.confidence || 0,
            f.source || null,
            f.status || 'DETECTED',
            f.requires_user_input ? 1 : 0,
          );
        }
      }

      // Determine final status
      let newStatus;
      switch (automationResult.status) {
        case 'CAPTCHA_DETECTED':
          newStatus = 'CAPTCHA_DETECTED';
          break;
        case 'LOGIN_REQUIRED':
          newStatus = 'LOGIN_REQUIRED';
          break;
        case 'USER_INPUT_REQUIRED':
          newStatus = 'USER_INPUT_REQUIRED';
          break;
        case 'BROWSER_PREPARED':
          newStatus = 'READY_FOR_REVIEW';
          break;
        case 'FAILED':
          newStatus = 'FAILED';
          break;
        default:
          newStatus = 'READY_FOR_REVIEW';
      }

      transitionStatus(app.id, newStatus, {
        ai_analysis: aiAnalysis,
        fields_data: automationResult.fields,
        error_message: automationResult.error,
      });

      addEvent(app.id, 'PROCESSED', {
        final_submit_detected: automationResult.finalSubmitDetected,
        fields_count: automationResult.fields.length,
        warnings: automationResult.warnings,
      });

      res.json({
        status: newStatus,
        fields_count: automationResult.fields.length,
        warnings: automationResult.warnings,
        ai_analysis: aiAnalysis,
        final_submit_detected: automationResult.finalSubmitDetected,
      });
    } else {
      // No URL - just do AI analysis
      transitionStatus(app.id, 'READY_FOR_REVIEW', { ai_analysis: aiAnalysis });
      res.json({ status: 'READY_FOR_REVIEW', ai_analysis: aiAnalysis });
    }
  } catch (err) {
    try {
      transitionStatus(app.id, 'FAILED', { error_message: err.message });
    } catch {}
    res.status(500).json({ error: err.message });
  } finally {
    releaseProcessingLock(app.id, lockId);
  }
});

// Retry application
router.post('/applications/:id/retry', async (req, res) => {
  const db = getDb();
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  // Central eligibility check
  const eligibility = checkApplicationEligibility(app.job_id);
  if (!eligibility.eligible) {
    return res.status(409).json({ error: 'Not eligible', ...eligibility });
  }

  // Reset to QUEUED
  try {
    transitionStatus(app.id, 'QUEUED', { reason: 'retry' });
    addEvent(app.id, 'RETRY_REQUESTED', {});
    res.json({ status: 'QUEUED' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Confirm submission - ONLY way to mark as SUBMITTED
router.post('/applications/:id/confirm-submitted', (req, res) => {
  const db = getDb();
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  if (!req.body.confirmation || req.body.confirmation !== 'I confirm that I manually submitted this application.') {
    return res.status(400).json({
      error: 'Explicit confirmation required',
      expected: 'I confirm that I manually submitted this application.',
    });
  }

  try {
    transitionStatus(app.id, 'SUBMITTED', {
      _userConfirmation: true,
      reason: 'User confirmed manual submission',
    });
    addEvent(app.id, 'SUBMISSION_CONFIRMED', {
      submission_confirmed_by_user: true,
      confirmed_at: new Date().toISOString(),
    });
    res.json({ status: 'SUBMITTED', submitted_at: new Date().toISOString() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update field
router.patch('/applications/:id/fields/:fieldId', (req, res) => {
  const db = getDb();
  const field = db.prepare('SELECT * FROM application_fields WHERE id = ? AND application_id = ?').get(req.params.fieldId, req.params.id);
  if (!field) return res.status(404).json({ error: 'Field not found' });

  const { value } = req.body;
  db.prepare(`
    UPDATE application_fields SET filled_value = ?, user_edited = 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(value, req.params.fieldId);

  res.json({ success: true });
});

// ─── Profile ────────────────────────────────────────────────────
router.get('/profile', (req, res) => {
  const db = getDb();
  const profile = db.prepare('SELECT * FROM candidate_profile WHERE id = 1').get();
  if (!profile) return res.json({});

  // Parse JSON fields
  const result = { ...profile };
  for (const field of ['education', 'skills', 'experience', 'projects', 'documents']) {
    try { result[field] = JSON.parse(result[field] || '[]'); } catch { result[field] = []; }
  }
  res.json(result);
});

router.put('/profile', (req, res) => {
  const db = getDb();
  const p = req.body;

  const jsonFields = ['education', 'skills', 'experience', 'projects', 'documents'];
  const values = {};
  for (const [key, val] of Object.entries(p)) {
    values[key] = jsonFields.includes(key) ? JSON.stringify(val) : val;
  }

  const fields = Object.keys(values).filter(k => k !== 'id');
  const setClauses = fields.map(f => `${f} = ?`).join(', ');
  const vals = fields.map(f => values[f]);

  db.prepare(`UPDATE candidate_profile SET ${setClauses}, updated_at = datetime('now') WHERE id = 1`).run(...vals);

  res.json({ success: true });
});

// ─── Settings ───────────────────────────────────────────────────
router.get('/settings', (req, res) => {
  const db = getDb();
  const settings = db.prepare('SELECT * FROM settings').all();
  const result = {};
  for (const s of settings) result[s.key] = s.value;
  res.json(result);
});

router.put('/settings', (req, res) => {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);

  for (const [key, value] of Object.entries(req.body)) {
    upsert.run(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  res.json({ success: true });
});

// ─── Stats ──────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as count FROM jobs').get().count;
  const statuses = db.prepare(`
    SELECT a.status, COUNT(*) as count
    FROM applications a
    GROUP BY a.status
  `).all();

  const statusMap = {};
  for (const s of statuses) statusMap[s.status] = s.count;

  res.json({
    total_jobs: total,
    imported: statusMap['IMPORTED'] || 0,
    queued: statusMap['QUEUED'] || 0,
    processing: statusMap['PROCESSING'] || 0,
    ready_for_review: statusMap['READY_FOR_REVIEW'] || 0,
    user_input_required: statusMap['USER_INPUT_REQUIRED'] || 0,
    browser_prepared: statusMap['BROWSER_PREPARED'] || 0,
    submitted: statusMap['SUBMITTED'] || 0,
    failed: statusMap['FAILED'] || 0,
    duplicate: statusMap['DUPLICATE'] || 0,
    already_applied: statusMap['ALREADY_APPLIED'] || 0,
    skipped: statusMap['SKIPPED'] || 0,
    human_action_required: statusMap['HUMAN_ACTION_REQUIRED'] || 0,
  });
});

module.exports = router;
