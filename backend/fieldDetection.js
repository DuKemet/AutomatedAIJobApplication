/**
 * Field detection - conservative by design.
 * Uses multiple signals to classify form fields.
 * Never fills ambiguous fields automatically.
 */

const SAFE_FIELD_CATEGORIES = [
  'FIRST_NAME', 'LAST_NAME', 'FULL_NAME', 'EMAIL', 'PHONE',
  'LINKEDIN', 'GITHUB', 'PORTFOLIO', 'RESUME_UPLOAD',
];

const RISKY_FIELD_CATEGORIES = [
  'SALARY', 'WORK_AUTHORIZATION', 'SPONSORSHIP', 'YEARS_OF_EXPERIENCE',
  'SECURITY_CLEARANCE', 'DEMOGRAPHICS', 'DISABILITY', 'VETERAN_STATUS',
  'LEGAL', 'CUSTOM', 'UNKNOWN',
];

const HIGH_CONFIDENCE_THRESHOLD = 0.85;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Deterministic field classification based on HTML attributes.
 */
function classifyFieldDeterministic(field) {
  const signals = [];
  const label = (field.label || '').toLowerCase().trim();
  const name = (field.name || '').toLowerCase().trim();
  const id = (field.id || '').toLowerCase().trim();
  const placeholder = (field.placeholder || '').toLowerCase().trim();
  const autocomplete = (field.autocomplete || '').toLowerCase().trim();
  const ariaLabel = (field.ariaLabel || '').toLowerCase().trim();
  const type = (field.type || '').toLowerCase().trim();
  const combined = `${label} ${name} ${id} ${placeholder} ${autocomplete} ${ariaLabel}`;

  // Autocomplete attribute (strongest signal)
  const autocompleteMap = {
    'given-name': { category: 'FIRST_NAME', confidence: 0.98, source: 'autocomplete' },
    'family-name': { category: 'LAST_NAME', confidence: 0.98, source: 'autocomplete' },
    'name': { category: 'FULL_NAME', confidence: 0.95, source: 'autocomplete' },
    'email': { category: 'EMAIL', confidence: 0.98, source: 'autocomplete' },
    'tel': { category: 'PHONE', confidence: 0.98, source: 'autocomplete' },
    'url': { category: 'PORTFOLIO', confidence: 0.6, source: 'autocomplete' },
  };

  if (autocomplete && autocompleteMap[autocomplete]) {
    return autocompleteMap[autocomplete];
  }

  // Input type (strong signal)
  if (type === 'email') {
    return { category: 'EMAIL', confidence: 0.95, source: 'input_type' };
  }
  if (type === 'tel') {
    return { category: 'PHONE', confidence: 0.95, source: 'input_type' };
  }
  if (type === 'file') {
    if (/resume|cv/i.test(combined)) {
      return { category: 'RESUME_UPLOAD', confidence: 0.95, source: 'input_type+label' };
    }
    if (/cover.?letter/i.test(combined)) {
      return { category: 'COVER_LETTER', confidence: 0.85, source: 'input_type+label' };
    }
    return { category: 'UNKNOWN', confidence: 0.3, source: 'input_type' };
  }

  // Name/id/label patterns (moderate-strong signal)
  const patterns = [
    { regex: /^(first.?name|fname|given.?name)$/i, category: 'FIRST_NAME', confidence: 0.95 },
    { regex: /^(last.?name|lname|family.?name|surname)$/i, category: 'LAST_NAME', confidence: 0.95 },
    { regex: /^(full.?name|name|your.?name|applicant.?name)$/i, category: 'FULL_NAME', confidence: 0.85 },
    { regex: /^(email|e.?mail|email.?address)$/i, category: 'EMAIL', confidence: 0.95 },
    { regex: /^(phone|telephone|mobile|cell|phone.?number)$/i, category: 'PHONE', confidence: 0.90 },
    { regex: /^(linkedin|linkedin.?url|linkedin.?profile)$/i, category: 'LINKEDIN', confidence: 0.95 },
    { regex: /^(github|github.?url|github.?profile)$/i, category: 'GITHUB', confidence: 0.95 },
    { regex: /^(portfolio|website|personal.?website|portfolio.?url)$/i, category: 'PORTFOLIO', confidence: 0.85 },
    { regex: /salary|compensation|pay|wage/i, category: 'SALARY', confidence: 0.85 },
    { regex: /work.?auth|authorized.?to.?work|visa|sponsorship/i, category: 'WORK_AUTHORIZATION', confidence: 0.80 },
    { regex: /years?.?of?.?experience|yoe/i, category: 'YEARS_OF_EXPERIENCE', confidence: 0.80 },
    { regex: /security.?clearance/i, category: 'SECURITY_CLEARANCE', confidence: 0.90 },
    { regex: /veteran|military/i, category: 'VETERAN_STATUS', confidence: 0.80 },
    { regex: /disability|disab/i, category: 'DISABILITY', confidence: 0.80 },
    { regex: /race|ethnicity|gender|demographic/i, category: 'DEMOGRAPHICS', confidence: 0.80 },
  ];

  // Check name, id, label, placeholder
  for (const source of [name, id, label, placeholder, ariaLabel]) {
    if (!source) continue;
    for (const p of patterns) {
      if (p.regex.test(source)) {
        return { category: p.category, confidence: p.confidence, source: 'pattern_match' };
      }
    }
  }

  // Check combined text for weaker signals
  if (/first\s*name/i.test(combined)) return { category: 'FIRST_NAME', confidence: 0.80, source: 'combined_text' };
  if (/last\s*name/i.test(combined)) return { category: 'LAST_NAME', confidence: 0.80, source: 'combined_text' };
  if (/email/i.test(combined)) return { category: 'EMAIL', confidence: 0.75, source: 'combined_text' };
  if (/phone/i.test(combined)) return { category: 'PHONE', confidence: 0.75, source: 'combined_text' };
  if (/linkedin/i.test(combined)) return { category: 'LINKEDIN', confidence: 0.80, source: 'combined_text' };
  if (/github/i.test(combined)) return { category: 'GITHUB', confidence: 0.80, source: 'combined_text' };

  return { category: 'UNKNOWN', confidence: 0, source: 'none' };
}

/**
 * Classify a list of detected fields. Use deterministic first, then optionally AI.
 */
function classifyFields(detectedFields, aiClassifications = null) {
  return detectedFields.map((field, index) => {
    const det = classifyFieldDeterministic(field);

    // If deterministic gave a good result, use it
    if (det.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
      return {
        ...field,
        field_category: det.category,
        confidence: det.confidence,
        source: det.source,
        fillable: SAFE_FIELD_CATEGORIES.includes(det.category),
        requires_user_input: false,
      };
    }

    // Check AI classification if available
    if (aiClassifications && aiClassifications[index]) {
      const ai = aiClassifications[index];
      // AI can boost confidence but we still validate
      if (ai.confidence > det.confidence && ai.confidence >= MEDIUM_CONFIDENCE_THRESHOLD) {
        const isSafe = SAFE_FIELD_CATEGORIES.includes(ai.category);
        const isHighConf = ai.confidence >= HIGH_CONFIDENCE_THRESHOLD;
        return {
          ...field,
          field_category: ai.category,
          confidence: ai.confidence,
          source: 'ai_classification',
          fillable: isSafe && isHighConf,
          requires_user_input: !isSafe || !isHighConf,
        };
      }
    }

    // Moderate deterministic result
    if (det.confidence >= MEDIUM_CONFIDENCE_THRESHOLD) {
      const isSafe = SAFE_FIELD_CATEGORIES.includes(det.category);
      return {
        ...field,
        field_category: det.category,
        confidence: det.confidence,
        source: det.source,
        fillable: false,
        requires_user_input: true,
      };
    }

    // Unknown
    return {
      ...field,
      field_category: det.category || 'UNKNOWN',
      confidence: det.confidence || 0,
      source: det.source || 'none',
      fillable: false,
      requires_user_input: det.category !== 'UNKNOWN',
    };
  });
}

/**
 * Get value for a field from candidate profile.
 */
function getFieldValue(category, profile) {
  if (!profile) return null;
  const map = {
    'FIRST_NAME': profile.first_name || (profile.name || '').split(' ')[0] || null,
    'LAST_NAME': profile.last_name || (profile.name || '').split(' ').slice(1).join(' ') || null,
    'FULL_NAME': profile.name || [profile.first_name, profile.last_name].filter(Boolean).join(' ') || null,
    'EMAIL': profile.email || null,
    'PHONE': profile.phone || null,
    'LINKEDIN': profile.linkedin || null,
    'GITHUB': profile.github || null,
    'PORTFOLIO': profile.portfolio || null,
  };
  return map[category] !== undefined ? map[category] : null;
}

// Submit button detection patterns
const SUBMIT_PATTERNS = [
  /submit\s*application/i,
  /^submit$/i,
  /^apply$/i,
  /^apply\s*now$/i,
  /send\s*application/i,
  /complete\s*application/i,
  /finish\s*application/i,
  /^confirm\s*application$/i,
  /^submit\s*and\s*apply$/i,
];

function isSubmitButton(text) {
  if (!text) return false;
  const cleaned = text.trim();
  return SUBMIT_PATTERNS.some(p => p.test(cleaned));
}

// CAPTCHA / human verification detection
const CAPTCHA_PATTERNS = [
  /captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /cloudflare/i,
  /human\s*verification/i,
  /bot\s*detection/i,
  /verify\s*you.*human/i,
  /i.?m\s*not\s*a\s*robot/i,
  /challenge-platform/i,
];

function detectCaptcha(pageContent) {
  return CAPTCHA_PATTERNS.some(p => p.test(pageContent));
}

module.exports = {
  SAFE_FIELD_CATEGORIES,
  RISKY_FIELD_CATEGORIES,
  HIGH_CONFIDENCE_THRESHOLD,
  MEDIUM_CONFIDENCE_THRESHOLD,
  classifyFieldDeterministic,
  classifyFields,
  getFieldValue,
  isSubmitButton,
  detectCaptcha,
  SUBMIT_PATTERNS,
  CAPTCHA_PATTERNS,
};
