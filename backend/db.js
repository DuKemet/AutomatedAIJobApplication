const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;

function getDb() {
  if (db) return db;
  const dbPath = process.env.DATABASE_PATH || './data/app.db';
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      job_id_fingerprint TEXT,
      company TEXT NOT NULL,
      normalized_company TEXT,
      title TEXT NOT NULL,
      normalized_title TEXT,
      url TEXT,
      canonical_url TEXT,
      url_fingerprint TEXT,
      company_title_fingerprint TEXT,
      location TEXT,
      description TEXT,
      requirements TEXT,
      salary TEXT,
      remote INTEGER,
      source TEXT,
      raw_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_job_id_fp ON jobs(job_id_fingerprint) WHERE job_id_fingerprint IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_jobs_url_fp ON jobs(url_fingerprint) WHERE url_fingerprint IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_jobs_ct_fp ON jobs(company_title_fingerprint) WHERE company_title_fingerprint IS NOT NULL;

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      status TEXT NOT NULL DEFAULT 'IMPORTED',
      processing_lock TEXT,
      lock_acquired_at TEXT,
      fields_data TEXT,
      ai_analysis TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      reviewed_at TEXT,
      submitted_at TEXT,
      submission_confirmed_by_user INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications(job_id);
    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

    CREATE TABLE IF NOT EXISTS application_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL REFERENCES applications(id),
      field_selector TEXT,
      field_label TEXT,
      field_type TEXT,
      field_category TEXT,
      detected_value TEXT,
      filled_value TEXT,
      confidence REAL DEFAULT 0,
      source TEXT,
      status TEXT DEFAULT 'DETECTED',
      requires_user_input INTEGER DEFAULT 0,
      user_edited INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_app_fields_app_id ON application_fields(application_id);

    CREATE TABLE IF NOT EXISTS application_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL REFERENCES applications(id),
      event_type TEXT NOT NULL,
      event_data TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_app_events_app_id ON application_events(application_id);

    CREATE TABLE IF NOT EXISTS candidate_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      phone TEXT,
      location TEXT,
      linkedin TEXT,
      github TEXT,
      portfolio TEXT,
      education TEXT,
      skills TEXT,
      experience TEXT,
      projects TEXT,
      documents TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO candidate_profile (id, name, email) VALUES (1, '', '');
  `);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb, initSchema };
