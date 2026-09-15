const crypto = require('crypto');

/**
 * Normalize text: trim, lowercase, collapse whitespace, remove insignificant punctuation, Unicode NFC.
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, '') // smart quotes
    .replace(/[''""]/g, '')
    .replace(/[.,;:!?()\[\]{}\-–—\/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a URL deterministically.
 */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url.trim());

    // Reject dangerous schemes
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;

    // Lowercase hostname
    parsed.hostname = parsed.hostname.toLowerCase();

    // Remove fragments
    parsed.hash = '';

    // Remove tracking params
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'ref', 'source', 'mc_cid', 'mc_eid',
    ];
    for (const p of trackingParams) {
      parsed.searchParams.delete(p);
    }

    // Sort remaining params for determinism
    parsed.searchParams.sort();

    let canonical = parsed.toString();

    // Normalize trailing slash for path-only URLs
    if (parsed.pathname !== '/' && canonical.endsWith('/')) {
      canonical = canonical.slice(0, -1);
    }

    return canonical;
  } catch {
    return null;
  }
}

function sha256(input) {
  if (!input) return null;
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Compute job_id_fingerprint from a stable external job ID.
 */
function computeJobIdFingerprint(jobId) {
  if (!jobId || typeof jobId !== 'string' || jobId.trim() === '') return null;
  return sha256(jobId.trim().toLowerCase());
}

/**
 * Compute url_fingerprint from a job URL.
 */
function computeUrlFingerprint(url) {
  const canonical = normalizeUrl(url);
  if (!canonical) return null;
  return sha256(canonical);
}

/**
 * Compute company_title_fingerprint.
 */
function computeCompanyTitleFingerprint(company, title) {
  const nc = normalizeText(company);
  const nt = normalizeText(title);
  if (!nc || !nt) return null;
  return sha256(nc + '|' + nt);
}

/**
 * Validate URL scheme is safe.
 */
function isUrlSafe(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

module.exports = {
  normalizeText,
  normalizeUrl,
  sha256,
  computeJobIdFingerprint,
  computeUrlFingerprint,
  computeCompanyTitleFingerprint,
  isUrlSafe,
};
