const API = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || res.statusText);
  }
  return res.json();
}

export const api = {
  getHealth: () => request('/health'),
  getStats: () => request('/stats'),
  getJobs: () => request('/jobs'),
  getJob: (id) => request(`/jobs/${id}`),
  importJobs: (jobs) => request('/jobs/import', { method: 'POST', body: JSON.stringify(jobs) }),
  getApplications: () => request('/applications'),
  getApplication: (id) => request(`/applications/${id}`),
  getReview: (id) => request(`/applications/${id}/review`),
  processApplication: (id) => request(`/applications/${id}/process`, { method: 'POST' }),
  retryApplication: (id) => request(`/applications/${id}/retry`, { method: 'POST' }),
  confirmSubmitted: (id) => request(`/applications/${id}/confirm-submitted`, {
    method: 'POST',
    body: JSON.stringify({ confirmation: 'I confirm that I manually submitted this application.' }),
  }),
  updateField: (appId, fieldId, value) => request(`/applications/${appId}/fields/${fieldId}`, {
    method: 'PATCH',
    body: JSON.stringify({ value }),
  }),
  getProfile: () => request('/profile'),
  updateProfile: (data) => request('/profile', { method: 'PUT', body: JSON.stringify(data) }),
  getSettings: () => request('/settings'),
  updateSettings: (data) => request('/settings', { method: 'PUT', body: JSON.stringify(data) }),
};
