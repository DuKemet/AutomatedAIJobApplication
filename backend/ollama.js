/**
 * Ollama client abstraction. Local AI only.
 */
class OllamaClient {
  constructor(baseUrl, model) {
    this.baseUrl = (baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
    this.model = model || process.env.OLLAMA_MODEL || 'llama3.2';
    this.timeout = 120000;
  }

  async checkAvailability() {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { available: false, error: 'Ollama responded with error' };
      const data = await res.json();
      const models = (data.models || []).map(m => m.name);
      const modelAvailable = models.some(m => m === this.model || m.startsWith(this.model + ':'));
      return { available: true, model_available: modelAvailable, models };
    } catch (err) {
      return { available: false, error: err.message };
    }
  }

  async generate(prompt, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: options.json ? 'json' : undefined,
          options: {
            temperature: options.temperature || 0.1,
            num_predict: options.maxTokens || 2048,
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama error ${res.status}: ${text}`);
      }

      const data = await res.json();
      return {
        response: data.response,
        model: data.model,
        done: data.done,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async generateJSON(prompt, options = {}) {
    const result = await this.generate(prompt, { ...options, json: true });
    try {
      const parsed = JSON.parse(result.response);
      return { ...result, parsed };
    } catch {
      return { ...result, parsed: null, parse_error: 'Invalid JSON from Ollama' };
    }
  }

  async analyzeJob(job, candidateProfile) {
    const compactJob = {
      title: job.title,
      company: job.company,
      location: job.location,
      description: (job.description || '').slice(0, 500),
      requirements: job.requirements,
      remote: job.remote,
    };

    const compactProfile = {
      skills: candidateProfile.skills,
      experience_summary: (candidateProfile.experience || []).length + ' positions',
      education: candidateProfile.education,
    };

    const prompt = `Analyze this job listing for a candidate. Return ONLY valid JSON.

Job:
${JSON.stringify(compactJob)}

Candidate skills: ${JSON.stringify(compactProfile.skills || [])}

Return JSON with:
{
  "fit_score": <0-100>,
  "matched_skills": ["skill1"],
  "missing_skills": ["skill2"],
  "recommendation": "apply" | "review" | "skip",
  "summary": "brief analysis"
}`;

    const result = await this.generateJSON(prompt);
    if (!result.parsed) {
      return { fit_score: 0, matched_skills: [], missing_skills: [], recommendation: 'review', summary: 'AI analysis failed', ai_error: result.parse_error };
    }
    return {
      fit_score: Math.min(100, Math.max(0, result.parsed.fit_score || 0)),
      matched_skills: result.parsed.matched_skills || [],
      missing_skills: result.parsed.missing_skills || [],
      recommendation: ['apply', 'review', 'skip'].includes(result.parsed.recommendation) ? result.parsed.recommendation : 'review',
      summary: result.parsed.summary || '',
      model: result.model,
      generated_at: new Date().toISOString(),
    };
  }

  async classifyFields(fields) {
    const compactFields = fields.map(f => ({
      label: f.label,
      name: f.name,
      id: f.id,
      type: f.type,
      placeholder: f.placeholder,
      autocomplete: f.autocomplete,
      ariaLabel: f.ariaLabel,
    }));

    const prompt = `Classify these form fields for a job application. Return ONLY valid JSON.

Fields:
${JSON.stringify(compactFields)}

For each field return:
{
  "fields": [
    {
      "index": 0,
      "category": "FIRST_NAME" | "LAST_NAME" | "FULL_NAME" | "EMAIL" | "PHONE" | "LINKEDIN" | "GITHUB" | "PORTFOLIO" | "RESUME_UPLOAD" | "COVER_LETTER" | "SALARY" | "WORK_AUTHORIZATION" | "SPONSORSHIP" | "YEARS_OF_EXPERIENCE" | "SECURITY_CLEARANCE" | "DEMOGRAPHICS" | "DISABILITY" | "VETERAN_STATUS" | "LEGAL" | "CUSTOM" | "UNKNOWN",
      "confidence": <0-1>,
      "reasoning": "brief reason"
    }
  ]
}`;

    const result = await this.generateJSON(prompt);
    if (!result.parsed || !Array.isArray(result.parsed.fields)) {
      return null;
    }
    return result.parsed.fields;
  }
}

/** Mock client for testing */
class MockOllamaClient {
  constructor() {
    this.responses = {};
  }

  setResponse(method, response) {
    this.responses[method] = response;
  }

  async checkAvailability() {
    return this.responses.checkAvailability || { available: true, model_available: true, models: ['test-model'] };
  }

  async generate(prompt) {
    return this.responses.generate || { response: '{}', model: 'test-model', done: true };
  }

  async generateJSON(prompt) {
    const gen = this.responses.generateJSON || { response: '{}', model: 'test-model', done: true, parsed: {} };
    return gen;
  }

  async analyzeJob(job, profile) {
    return this.responses.analyzeJob || {
      fit_score: 75,
      matched_skills: ['React'],
      missing_skills: ['AWS'],
      recommendation: 'apply',
      summary: 'Good fit',
      model: 'test-model',
      generated_at: new Date().toISOString(),
    };
  }

  async classifyFields(fields) {
    return this.responses.classifyFields || fields.map((f, i) => ({
      index: i,
      category: 'UNKNOWN',
      confidence: 0.3,
      reasoning: 'mock',
    }));
  }
}

module.exports = { OllamaClient, MockOllamaClient };
