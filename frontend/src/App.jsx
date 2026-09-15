import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api.js';

function getStatusBadge(status) {
  const map = {
    'IMPORTED': 'badge-imported', 'QUEUED': 'badge-imported',
    'PROCESSING': 'badge-processing',
    'READY_FOR_REVIEW': 'badge-ready', 'BROWSER_PREPARED': 'badge-ready',
    'SUBMITTED': 'badge-submitted',
    'FAILED': 'badge-failed',
    'DUPLICATE': 'badge-duplicate', 'ALREADY_APPLIED': 'badge-duplicate',
    'SKIPPED': 'badge-duplicate',
    'HUMAN_ACTION_REQUIRED': 'badge-human', 'LOGIN_REQUIRED': 'badge-human',
    'CAPTCHA_DETECTED': 'badge-human',
    'USER_INPUT_REQUIRED': 'badge-input',
  };
  return map[status] || 'badge-imported';
}

function FitScore({ score }) {
  if (score == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const cls = score >= 70 ? 'fit-score-high' : score >= 40 ? 'fit-score-medium' : 'fit-score-low';
  return <div className={`fit-score ${cls}`}>{score}</div>;
}

// ─── Dashboard ──────────────────────────────────────────────────
function Dashboard({ onNavigate }) {
  const [stats, setStats] = useState(null);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api.getStats().then(setStats).catch(console.error);
    api.getHealth().then(setHealth).catch(console.error);
  }, []);

  if (!stats) return <div className="loading-container"><div className="spinner" /> Loading...</div>;

  const cards = [
    { label: 'Total Jobs', value: stats.total_jobs, color: 'var(--accent)' },
    { label: 'Imported', value: stats.imported },
    { label: 'Ready for Review', value: stats.ready_for_review, color: 'var(--success)' },
    { label: 'Needs Input', value: stats.user_input_required, color: 'var(--warning)' },
    { label: 'Submitted', value: stats.submitted, color: '#34d399' },
    { label: 'Already Applied', value: stats.already_applied },
    { label: 'Duplicates', value: stats.duplicate },
    { label: 'Failed', value: stats.failed, color: 'var(--danger)' },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Overview of your job applications</p>
      </div>

      {health && (
        <div className={`alert ${health.ollama?.available ? 'alert-success' : 'alert-warning'}`}>
          {health.ollama?.available
            ? `✓ Ollama connected (model: ${health.ollama.model_available ? 'ready' : 'not found'})`
            : '⚠ Ollama unavailable — AI features disabled'}
        </div>
      )}

      <div className="stats-grid">
        {cards.map((c, i) => (
          <div key={i} className="stat-card">
            <div className="stat-value" style={c.color ? { color: c.color } : {}}>{c.value}</div>
            <div className="stat-label">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Job List ───────────────────────────────────────────────────
function JobList({ onNavigate }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.getApplications().then(data => { setJobs(data); setLoading(false); }).catch(e => { console.error(e); setLoading(false); });
  }, []);

  useEffect(load, [load]);

  async function handleProcess(id) {
    try {
      await api.processApplication(id);
      load();
    } catch (e) { alert(e.message); }
  }

  async function handleRetry(id) {
    try {
      await api.retryApplication(id);
      load();
    } catch (e) { alert(e.message); }
  }

  if (loading) return <div className="loading-container"><div className="spinner" /> Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Applications</h1>
        <p>{jobs.length} total applications</p>
      </div>
      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Role</th>
                <th>Location</th>
                <th>Status</th>
                <th>Fit</th>
                <th>Imported</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => {
                let aiAnalysis = null;
                try { aiAnalysis = job.ai_analysis ? JSON.parse(job.ai_analysis) : null; } catch {}
                return (
                  <tr key={job.id}>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{job.company}</td>
                    <td>{job.title}</td>
                    <td>{job.location || '—'}</td>
                    <td><span className={`badge ${getStatusBadge(job.status)}`}>{job.status}</span></td>
                    <td><FitScore score={aiAnalysis?.fit_score} /></td>
                    <td style={{ fontSize: '12px' }}>{new Date(job.created_at).toLocaleDateString()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('review', job.id)}>View</button>
                        {['IMPORTED', 'QUEUED'].includes(job.status) && (
                          <button className="btn btn-primary btn-sm" onClick={() => handleProcess(job.id)}>Process</button>
                        )}
                        {['FAILED'].includes(job.status) && (
                          <button className="btn btn-secondary btn-sm" onClick={() => handleRetry(job.id)}>Retry</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Import ─────────────────────────────────────────────────────
function ImportPage() {
  const [jsonText, setJsonText] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);

  async function handleImport() {
    setError(null);
    setResults(null);
    try {
      const parsed = JSON.parse(jsonText);
      setImporting(true);
      const res = await api.importJobs(parsed);
      setResults(res);
      setImporting(false);
    } catch (e) {
      setError(e.message);
      setImporting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Import Jobs</h1>
        <p>Paste job JSON from ChatGPT</p>
      </div>
      <div className="card">
        <div className="form-group">
          <label className="form-label">Job JSON</label>
          <textarea
            className="form-textarea"
            rows={12}
            value={jsonText}
            onChange={e => setJsonText(e.target.value)}
            placeholder={`[\n  {\n    "title": "Software Engineer",\n    "company": "Example Corp",\n    "url": "https://example.com/jobs/123",\n    "location": "Remote"\n  }\n]`}
          />
        </div>
        {error && <div className="alert alert-danger">⚠ {error}</div>}
        <button className="btn btn-primary" onClick={handleImport} disabled={importing || !jsonText.trim()}>
          {importing ? <><div className="spinner" /> Importing...</> : 'Import Jobs'}
        </button>
        {results && (
          <div className="import-results" style={{ marginTop: '16px' }}>
            <span className="import-result-badge" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
              Imported: {results.imported}
            </span>
            <span className="import-result-badge" style={{ background: 'rgba(107,114,128,0.15)', color: '#9ca3af' }}>
              Duplicates: {results.duplicates}
            </span>
            <span className="import-result-badge" style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>
              Already Applied: {results.already_applied}
            </span>
            <span className="import-result-badge" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
              Invalid: {results.invalid}
            </span>
          </div>
        )}
        {results?.details?.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Matched By</th>
                </tr>
              </thead>
              <tbody>
                {results.details.map((d, i) => (
                  <tr key={i}>
                    <td>{d.company}</td>
                    <td>{d.title}</td>
                    <td><span className={`badge ${getStatusBadge(d.status)}`}>{d.status}</span></td>
                    <td>{d.matched_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Review Screen ──────────────────────────────────────────────
function ReviewScreen({ applicationId, onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmModal, setConfirmModal] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    api.getReview(applicationId).then(d => { setData(d); setLoading(false); }).catch(e => { console.error(e); setLoading(false); });
  }, [applicationId]);

  async function handleConfirmSubmit() {
    setConfirming(true);
    try {
      await api.confirmSubmitted(applicationId);
      setConfirmModal(false);
      const d = await api.getReview(applicationId);
      setData(d);
    } catch (e) { alert(e.message); }
    setConfirming(false);
  }

  if (loading) return <div className="loading-container"><div className="spinner" /> Loading review...</div>;
  if (!data) return <div className="alert alert-danger">Application not found</div>;

  const { job, application, fields, ai_analysis, events, warnings } = data;
  let parsedRequirements = [];
  try { parsedRequirements = typeof job.requirements === 'string' ? JSON.parse(job.requirements) : (job.requirements || []); } catch {}

  const fieldsList = Array.isArray(fields) ? fields : [];
  const safeFields = fieldsList.filter(f => f.status === 'FILLED');
  const userInputFields = fieldsList.filter(f => f.requires_user_input);
  const unknownFields = fieldsList.filter(f => f.field_category === 'UNKNOWN');

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('jobs')}>← Back</button>
          <div>
            <h1>{job.title}</h1>
            <p>{job.company} {job.location ? `• ${job.location}` : ''}</p>
          </div>
        </div>
      </div>

      {/* Job Info */}
      <div className="card review-section">
        <div className="review-section-title">Job Details</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px' }}>
          <div><span style={{ color: 'var(--text-muted)' }}>Company:</span> <strong>{job.company}</strong></div>
          <div><span style={{ color: 'var(--text-muted)' }}>Role:</span> <strong>{job.title}</strong></div>
          <div><span style={{ color: 'var(--text-muted)' }}>Location:</span> {job.location || '—'}</div>
          <div><span style={{ color: 'var(--text-muted)' }}>Remote:</span> {job.remote ? 'Yes' : 'No'}</div>
          {job.url && (
            <div style={{ gridColumn: '1/3' }}>
              <span style={{ color: 'var(--text-muted)' }}>URL:</span>{' '}
              <a href={job.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{job.url}</a>
            </div>
          )}
          {parsedRequirements.length > 0 && (
            <div style={{ gridColumn: '1/3' }}>
              <span style={{ color: 'var(--text-muted)' }}>Requirements:</span>{' '}
              {parsedRequirements.map((r, i) => (
                <span key={i} className="badge badge-imported" style={{ marginRight: '4px', marginBottom: '4px' }}>{r}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Status */}
      <div className="card review-section">
        <div className="review-section-title">Application Status</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span className={`badge ${getStatusBadge(application.status)}`} style={{ fontSize: '14px', padding: '6px 16px' }}>
            {application.status}
          </span>
          {ai_analysis && <FitScore score={ai_analysis.fit_score} />}
        </div>
        {application.submitted_at && (
          <p style={{ marginTop: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Submitted: {new Date(application.submitted_at).toLocaleString()}
          </p>
        )}
      </div>

      {/* AI Analysis */}
      {ai_analysis && (
        <div className="card review-section">
          <div className="review-section-title">AI Analysis</div>
          <p style={{ marginBottom: '8px', fontSize: '14px' }}>{ai_analysis.summary}</p>
          <div style={{ display: 'flex', gap: '20px', fontSize: '13px' }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Recommendation:</span>{' '}
              <strong style={{ color: ai_analysis.recommendation === 'apply' ? 'var(--success)' : 'var(--warning)' }}>
                {ai_analysis.recommendation?.toUpperCase()}
              </strong>
            </div>
          </div>
          {ai_analysis.matched_skills?.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Matched:</span>{' '}
              {ai_analysis.matched_skills.map((s, i) => (
                <span key={i} className="badge badge-ready" style={{ marginRight: '4px' }}>{s}</span>
              ))}
            </div>
          )}
          {ai_analysis.missing_skills?.length > 0 && (
            <div style={{ marginTop: '4px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Missing:</span>{' '}
              {ai_analysis.missing_skills.map((s, i) => (
                <span key={i} className="badge badge-failed" style={{ marginRight: '4px' }}>{s}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fields */}
      {fieldsList.length > 0 && (
        <div className="card review-section">
          <div className="review-section-title">Form Fields</div>
          <div className="field-row" style={{ fontWeight: 700, color: 'var(--text-muted)' }}>
            <div>Field</div>
            <div>Value</div>
            <div>Source</div>
            <div>Conf.</div>
            <div>Status</div>
          </div>
          {fieldsList.map((f, i) => (
            <div key={i} className="field-row">
              <div className="field-label-cell">{f.field_label || f.field_category || '—'}</div>
              <div className="field-value-cell">{f.filled_value || f.detected_value || '—'}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{f.source || '—'}</div>
              <div className={`field-confidence ${
                f.confidence >= 0.85 ? 'confidence-high' : f.confidence >= 0.5 ? 'confidence-medium' : 'confidence-low'
              }`}>
                {f.confidence != null ? `${Math.round(f.confidence * 100)}%` : '—'}
              </div>
              <div>
                <span className={`badge ${
                  f.status === 'FILLED' ? 'badge-ready' :
                  f.requires_user_input ? 'badge-input' :
                  f.status === 'FILL_ERROR' ? 'badge-failed' : 'badge-duplicate'
                }`}>
                  {f.requires_user_input ? 'USER INPUT' : f.status || '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Warnings */}
      {(userInputFields.length > 0 || unknownFields.length > 0) && (
        <div className="card review-section">
          <div className="review-section-title">Warnings</div>
          {userInputFields.length > 0 && (
            <div className="alert alert-warning">
              ⚠ {userInputFields.length} field(s) require user input: {userInputFields.map(f => f.field_label || f.field_category).join(', ')}
            </div>
          )}
          {unknownFields.length > 0 && (
            <div className="alert alert-info">
              ℹ {unknownFields.length} field(s) were not classified and left unfilled
            </div>
          )}
        </div>
      )}

      {/* Submission Warning */}
      <div className="submission-warning">
        <h3>⚠ AUTOMATION HAS STOPPED</h3>
        <p>
          The application has <strong>NOT</strong> been submitted.<br />
          Review the application manually and submit it yourself on the website.
        </p>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
        {['READY_FOR_REVIEW', 'BROWSER_PREPARED', 'HUMAN_ACTION_REQUIRED'].includes(application.status) && (
          <button className="btn btn-success" onClick={() => setConfirmModal(true)}>
            ✓ Mark as Submitted
          </button>
        )}
        {job.url && (
          <a href={job.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Open Job Page ↗
          </a>
        )}
      </div>

      {/* History */}
      {events && events.length > 0 && (
        <div className="card review-section" style={{ marginTop: '24px' }}>
          <div className="review-section-title">Application History</div>
          {events.map((e, i) => {
            let eventData = {};
            try { eventData = JSON.parse(e.event_data); } catch {}
            return (
              <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid rgba(42,53,80,0.3)', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-muted)' }}>{new Date(e.created_at).toLocaleString()}</span>
                {' '}
                <span className="badge badge-imported" style={{ fontSize: '10px' }}>{e.event_type}</span>
                {eventData.from && eventData.to && (
                  <span style={{ color: 'var(--text-secondary)', marginLeft: '8px' }}>
                    {eventData.from} → {eventData.to}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="modal-overlay" onClick={() => setConfirmModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Confirm Manual Submission</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.6 }}>
              By clicking confirm, you are stating:<br />
              <strong style={{ color: 'var(--warning)' }}>
                "I confirm that I manually submitted this application."
              </strong>
            </p>
            <div className="alert alert-warning">
              This action cannot be undone. Only confirm if you have actually submitted the application on the employer's website.
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button className="btn btn-secondary" onClick={() => setConfirmModal(false)}>Cancel</button>
              <button className="btn btn-success" onClick={handleConfirmSubmit} disabled={confirming}>
                {confirming ? <><div className="spinner" /> Confirming...</> : 'I Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Profile Page ───────────────────────────────────────────────
function ProfilePage() {
  const [profile, setProfile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getProfile().then(setProfile).catch(console.error);
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateProfile(profile);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  if (!profile) return <div className="loading-container"><div className="spinner" /> Loading...</div>;

  const textFields = [
    { key: 'name', label: 'Full Name' },
    { key: 'first_name', label: 'First Name' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'location', label: 'Location' },
    { key: 'linkedin', label: 'LinkedIn URL' },
    { key: 'github', label: 'GitHub URL' },
    { key: 'portfolio', label: 'Portfolio URL' },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Candidate Profile</h1>
        <p>Your information for auto-filling applications</p>
      </div>
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {textFields.map(f => (
            <div key={f.key} className="form-group">
              <label className="form-label">{f.label}</label>
              <input
                className="form-input"
                value={profile[f.key] || ''}
                onChange={e => setProfile({ ...profile, [f.key]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="form-group">
          <label className="form-label">Skills (comma separated)</label>
          <input
            className="form-input"
            value={Array.isArray(profile.skills) ? profile.skills.join(', ') : ''}
            onChange={e => setProfile({ ...profile, skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
          />
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <><div className="spinner" /> Saving...</> : 'Save Profile'}
          </button>
          {saved && <span style={{ color: 'var(--success)', fontSize: '13px' }}>✓ Saved</span>}
        </div>
      </div>
    </div>
  );
}

// ─── App ────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState('dashboard');
  const [reviewId, setReviewId] = useState(null);

  function navigate(p, id) {
    if (p === 'review' && id) {
      setReviewId(id);
      setPage('review');
    } else {
      setPage(p);
    }
  }

  const navItems = [
    { id: 'dashboard', icon: '◈', label: 'Dashboard' },
    { id: 'jobs', icon: '◎', label: 'Applications' },
    { id: 'import', icon: '⊕', label: 'Import Jobs' },
    { id: 'profile', icon: '◉', label: 'Profile' },
  ];

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-logo">Job Assistant</div>
        {navItems.map(item => (
          <div
            key={item.id}
            className={`nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => navigate(item.id)}
          >
            <span>{item.icon}</span>
            {item.label}
          </div>
        ))}
      </nav>
      <main className="main-content">
        {page === 'dashboard' && <Dashboard onNavigate={navigate} />}
        {page === 'jobs' && <JobList onNavigate={navigate} />}
        {page === 'import' && <ImportPage />}
        {page === 'profile' && <ProfilePage />}
        {page === 'review' && reviewId && <ReviewScreen applicationId={reviewId} onNavigate={navigate} />}
      </main>
    </div>
  );
}
