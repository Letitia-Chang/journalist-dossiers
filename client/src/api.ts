import axios from 'axios';
import type { CompanyProfile, SetupStatus } from './types';

const TOKEN_KEY = 'pd_auth_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const API_ORIGIN = API_URL.replace(/\/api\/?$/, '');

const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.request.use(config => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      clearToken();
      window.dispatchEvent(new Event('pd:logout'));
    }
    return Promise.reject(err);
  },
);

export interface AuthResponse {
  token: string;
  user: { id: string; email: string; name: string; role: string };
  org: { id: string; name: string; slug: string };
}

// First-run only: creates the owner account for this deployment's single company.
export const signup = (data: { email: string; password: string; name: string }) =>
  axios.post<AuthResponse>(`${API_URL}/auth/signup`, data);

export const demoLogin = () => axios.post<AuthResponse>(`${API_URL}/auth/demo-login`);

export const setup = {
  status: () => axios.get<SetupStatus>(`${API_URL}/setup/status`),
};

export const company = {
  get: () => api.get<{ exists: boolean; profile: CompanyProfile }>('/company'),
  save: (profile: CompanyProfile) => api.put<{ exists: boolean; profile: CompanyProfile }>('/company', profile),
};

export const login = (email: string, password: string) =>
  axios.post<AuthResponse>(`${API_URL}/auth/login`, { email, password });

export default api;

export const journalists = {
  list: () => api.get('/journalists'),
  get: (id: number) => api.get(`/journalists/${id}`),
  create: (data: object) => api.post('/journalists', data),
  update: (id: number, data: object) => api.put(`/journalists/${id}`, data),
  delete: (id: number) => api.delete(`/journalists/${id}`),
  scoreWithAI: (id: number) => api.post(`/journalists/${id}/score`),
};

export const scoringDimensions = {
  list: () => api.get('/scoring-dimensions'),
  create: (data: object) => api.post('/scoring-dimensions', data),
  update: (id: number, data: object) => api.put(`/scoring-dimensions/${id}`, data),
  delete: (id: number) => api.delete(`/scoring-dimensions/${id}`),
};

export const articles = {
  byJournalist: (id: number) => api.get(`/articles/journalist/${id}`),
  create: (data: object) => api.post('/articles', data),
  update: (id: number, data: object) => api.put(`/articles/${id}`, data),
  delete: (id: number) => api.delete(`/articles/${id}`),
};

export const outreach = {
  byJournalist: (id: number) => api.get(`/outreach/journalist/${id}`),
  activity: (params?: Record<string, string | number | boolean | undefined>) => api.get('/outreach/activity', { params }),
  create: (data: object) => api.post('/outreach', data),
  delete: (id: number) => api.delete(`/outreach/${id}`),
};

export const dashboard = {
  get: () => api.get('/dashboard'),
};

export const campaigns = {
  list: () => api.get('/campaigns'),
  get: (id: number) => api.get(`/campaigns/${id}`),
  create: (data: object) => api.post('/campaigns', data),
  update: (id: number, data: object) => api.put(`/campaigns/${id}`, data),
  delete: (id: number) => api.delete(`/campaigns/${id}`),
  getJournalists: (id: number) => api.get(`/campaigns/${id}/journalists`),
  addJournalists: (id: number, journalistIds: number[]) => api.post(`/campaigns/${id}/journalists`, { journalistIds }),
  removeJournalist: (id: number, journalistId: number) => api.delete(`/campaigns/${id}/journalists/${journalistId}`),
  generateDrafts: (id: number) => api.post(`/campaigns/${id}/generate-drafts`),
  regenerateDraft: (id: number, journalistId: number, instructions: string) =>
    api.post(`/campaigns/${id}/journalists/${journalistId}/regenerate`, { instructions }),
  updateDraft: (id: number, journalistId: number, data: object) => api.put(`/campaigns/${id}/journalists/${journalistId}/draft`, data),
  markSent: (id: number, journalistId: number) => api.post(`/campaigns/${id}/journalists/${journalistId}/send`),
  createGmailDrafts: (id: number) => api.post(`/campaigns/${id}/create-gmail-drafts`),
};

export const auth = {
  gmailStatus: () => api.get('/auth/gmail/status', { baseURL: API_ORIGIN }),
  // Open the popup before awaiting, or the browser blocks it as not user-initiated.
  connectGmail: async () => {
    const popup = window.open('', '_blank', 'width=500,height=600');
    try {
      const { data } = await api.post<{ url: string }>('/auth/google/start', null, { baseURL: API_ORIGIN });
      if (popup) popup.location.href = data.url;
      else window.location.href = data.url;
    } catch (err) {
      popup?.close();
      throw err;
    }
  },
  disconnectGmail: () => api.delete('/auth/gmail', { baseURL: API_ORIGIN }),
};

export const publications = {
  list:   () => api.get('/publications'),
  get:    (id: number) => api.get(`/publications/${id}`),
  create: (data: object) => api.post('/publications', data),
  update: (id: number, data: object) => api.put(`/publications/${id}`, data),
  delete: (id: number) => api.delete(`/publications/${id}`),
  getFeeds:      (id: number) => api.get(`/publications/${id}/feeds`),
  getJournalists: (id: number) => api.get(`/publications/${id}/journalists`),
  discover: (query: string) => api.post('/publications/discover', { query }),
  discoverFeeds: (id: number) => api.post(`/publications/${id}/discover-feeds`),
  addFeed:       (id: number, feedUrl: string, feedLabel: string) => api.post(`/publications/${id}/feeds`, { feedUrl, feedLabel }),
  deleteFeed:    (id: number, feedId: number) => api.delete(`/publications/${id}/feeds/${feedId}`),
  syncFeeds: () => api.post('/publications/sync-feeds'),
  importOpml: (opml: string) => api.post('/publications/import-opml', { opml }),
};

export const journalistSuggestions = {
  list: () => api.get('/journalist-suggestions'),
  count: () => api.get('/journalist-suggestions/count'),
  accept: (id: number) => api.post(`/journalist-suggestions/${id}/accept`),
  reject: (id: number) => api.post(`/journalist-suggestions/${id}/reject`),
  history: () => api.get('/journalist-suggestions/history'),
  staffScan: (publicationId: number) => api.post(`/journalist-suggestions/staff-scan/${publicationId}`),
  scanAll: () => api.post('/journalist-suggestions/scan-all'),
};

export const healthCheck = {
  summary: () => api.get('/publications/health-summary'),
  runNow: () => api.post('/publications/check-feeds'),
};

export const suggestions = {
  list: () => api.get('/suggestions'),
  count: () => api.get('/suggestions/count'),
  accept: (id: number) => api.post(`/suggestions/${id}/accept`),
  reject: (id: number) => api.post(`/suggestions/${id}/reject`),
  history: () => api.get('/suggestions/history'),
  runNow: () => api.post('/suggestions/run-now'),
};

export const coverage = {
  list:      (params?: Record<string, string | number | boolean | undefined>) => api.get('/coverage', { params }),
  create:    (data: object)    => api.post('/coverage', data),
  update:    (id: number, data: object) => api.put(`/coverage/${id}`, data),
  delete:    (id: number)   => api.delete(`/coverage/${id}`),
};

export const team = {
  members: () => api.get('/team/members'),
  updateMemberRole: (id: string, role: string) => api.put(`/team/members/${id}/role`, { role }),
  removeMember: (id: string) => api.delete(`/team/members/${id}`),
  invites: () => api.get('/team/invites'),
  createInvite: (email: string, role: string) => api.post('/team/invites', { email, role }),
  revokeInvite: (id: string) => api.delete(`/team/invites/${id}`),
};

export const getInvite = (token: string) => axios.get<{ email: string; role: string; orgName: string }>(`${API_URL}/auth/invite/${token}`);

export const acceptInvite = (data: { token: string; name: string; password: string }) =>
  axios.post<AuthResponse>(`${API_URL}/auth/accept-invite`, data);

export const campaignStyles = {
  list: () => api.get('/campaign-styles'),
  update: (type: string, instructions: string) => api.put(`/campaign-styles/${type}`, { instructions }),
};

// Export requires the JWT auth header, so a plain <a href> download won't work —
// fetch authenticated via axios, then trigger the download from a Blob URL.
export const downloadExport = async (type: 'journalists' | 'articles' | 'outreach', filename: string) => {
  const res = await api.get(`/export/${type}`, { responseType: 'blob' });
  const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
