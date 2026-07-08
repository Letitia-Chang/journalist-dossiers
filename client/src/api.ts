import axios from 'axios';

const TOKEN_KEY = 'ns_auth_token';

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
      window.dispatchEvent(new Event('ns:logout'));
    }
    return Promise.reject(err);
  },
);

export interface AuthResponse {
  token: string;
  user: { id: string; email: string; name: string; role: string };
  org: { id: string; name: string; slug: string; company_description?: string; target_verticals?: string[] };
}

export const signup = (data: {
  orgName: string;
  email: string;
  password: string;
  name: string;
  companyDescription?: string;
  targetVerticals?: string[];
}) => axios.post<AuthResponse>(`${API_URL}/auth/signup`, data);

export const login = (email: string, password: string) =>
  axios.post<AuthResponse>(`${API_URL}/auth/login`, { email, password });

export default api;

export const journalists = {
  // params accepted for backward compatibility with not-yet-rewritten pages;
  // the org-scoped backend doesn't support server-side sort/filter yet.
  list: (_params?: any) => api.get('/journalists'),
  get: (id: number) => api.get(`/journalists/${id}`),
  create: (data: any) => api.post('/journalists', data),
  update: (id: number, data: any) => api.put(`/journalists/${id}`, data),
  delete: (id: number) => api.delete(`/journalists/${id}`),
  scoreWithAI: (id: number) => api.post(`/journalists/${id}/score`),
  // Not yet implemented on the org-scoped backend (deferred to later phases):
  bulkRescore: () => api.post('/journalists/bulk-rescore'),
  backfillArticles: () => api.post('/journalists/backfill-articles'),
  toggleFavorite: (id: number) => api.patch(`/journalists/${id}/favorite`),
  uploadPhoto: (id: number, photoUrl: string) => api.post(`/journalists/${id}/photo`, { photoUrl }),
  rescore: (id: number) => api.post(`/journalists/${id}/rescore`),
  refreshArticles: () => api.post('/journalist-articles/refresh-now'),
};

export const scoringDimensions = {
  list: () => api.get('/scoring-dimensions'),
  create: (data: any) => api.post('/scoring-dimensions', data),
  update: (id: number, data: any) => api.put(`/scoring-dimensions/${id}`, data),
  delete: (id: number) => api.delete(`/scoring-dimensions/${id}`),
};

export const articles = {
  byJournalist: (id: number) => api.get(`/articles/journalist/${id}`),
  create: (data: any) => api.post('/articles', data),
  update: (id: number, data: any) => api.put(`/articles/${id}`, data),
  delete: (id: number) => api.delete(`/articles/${id}`),
};

export const outreach = {
  byJournalist: (id: number) => api.get(`/outreach/journalist/${id}`),
  activity: (params?: any) => api.get('/outreach/activity', { params }),
  create: (data: any) => api.post('/outreach', data),
  update: (id: number, data: any) => api.put(`/outreach/${id}`, data),
  delete: (id: number) => api.delete(`/outreach/${id}`),
};

export const dashboard = {
  get: () => api.get('/dashboard'),
};

export const campaigns = {
  list: () => api.get('/campaigns'),
  get: (id: number) => api.get(`/campaigns/${id}`),
  create: (data: any) => api.post('/campaigns', data),
  update: (id: number, data: any) => api.put(`/campaigns/${id}`, data),
  delete: (id: number) => api.delete(`/campaigns/${id}`),
  getJournalists: (id: number) => api.get(`/campaigns/${id}/journalists`),
  addJournalists: (id: number, journalistIds: number[]) => api.post(`/campaigns/${id}/journalists`, { journalistIds }),
  removeJournalist: (id: number, journalistId: number) => api.delete(`/campaigns/${id}/journalists/${journalistId}`),
  generateDrafts: (id: number) => api.post(`/campaigns/${id}/generate-drafts`),
  suggestJournalists: (id: number) => api.post(`/campaigns/${id}/suggest-journalists`),
  regenerateDraft: (id: number, journalistId: number, instructions: string) =>
    api.post(`/campaigns/${id}/journalists/${journalistId}/regenerate`, { instructions }),
  updateDraft: (id: number, journalistId: number, data: any) => api.put(`/campaigns/${id}/journalists/${journalistId}/draft`, data),
  markSent: (id: number, journalistId: number, campaignType: string) => api.post(`/campaigns/${id}/journalists/${journalistId}/send`, { campaignType }),
  getCoverage: (id: number) => api.get(`/campaigns/${id}/coverage`),
  linkCoverage: (id: number, coverageId: number) => api.post(`/campaigns/${id}/coverage/link`, { coverageId }),
  unlinkCoverage: (id: number, coverageId: number) => api.delete(`/campaigns/${id}/coverage/${coverageId}/unlink`),
  createGmailDrafts: (id: number) => api.post(`/campaigns/${id}/create-gmail-drafts`),
};

export const auth = {
  gmailStatus: () => api.get('/auth/gmail/status', { baseURL: API_ORIGIN }),
  connectGmail: () => {
    const token = getToken();
    window.open(`${API_ORIGIN}/auth/google?token=${encodeURIComponent(token ?? '')}`, '_blank', 'width=500,height=600');
  },
  disconnectGmail: () => api.delete('/auth/gmail', { baseURL: API_ORIGIN }),
};

export const publications = {
  list:   () => api.get('/publications'),
  get:    (id: number) => api.get(`/publications/${id}`),
  create: (data: any) => api.post('/publications', data),
  update: (id: number, data: any) => api.put(`/publications/${id}`, data),
  delete: (id: number) => api.delete(`/publications/${id}`),
  getFeeds:      (id: number) => api.get(`/publications/${id}/feeds`),
  getJournalists: (id: number) => api.get(`/publications/${id}/journalists`),
  discover: (query: string) => api.post('/publications/discover', { query }),
  discoverRss: (id: number) => api.post(`/publications/${id}/discover-rss`),
  discoverFeeds: (id: number) => api.post(`/publications/${id}/discover-feeds`),
  addFeed:       (id: number, feedUrl: string, feedLabel: string) => api.post(`/publications/${id}/feeds`, { feedUrl, feedLabel }),
  deleteFeed:    (id: number, feedId: number) => api.delete(`/publications/${id}/feeds/${feedId}`),
  checkAllFeeds: () => api.post('/publications/check-feeds'),
  syncFeeds: () => api.post('/publications/sync-feeds'),
  importOpml: (opml: string) => api.post('/publications/import-opml', { opml }),
};

export const journalistSuggestions = {
  list: () => api.get('/journalist-suggestions'),
  count: () => api.get('/journalist-suggestions/count'),
  accept: (id: number) => api.post(`/journalist-suggestions/${id}/accept`),
  reject: (id: number) => api.post(`/journalist-suggestions/${id}/reject`),
  history: () => api.get('/journalist-suggestions/history'),
  scanPublication: (publicationId: number) => api.post(`/journalist-suggestions/scan/${publicationId}`),
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
  list:      (params?: any) => api.get('/coverage', { params }),
  get:       (id: number)   => api.get(`/coverage/${id}`),
  create:    (data: any)    => api.post('/coverage', data),
  update:    (id: number, data: any) => api.put(`/coverage/${id}`, data),
  delete:    (id: number)   => api.delete(`/coverage/${id}`),
  fetchMeta:  (url: string)  => api.post('/coverage/fetch-meta', { url }),
  parseText:  (text: string) => api.post('/coverage/parse-text', { text }),
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
