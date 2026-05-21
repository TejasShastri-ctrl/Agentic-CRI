import { apiClient } from './client.js';

export const analyticsService = {
  getSentimentTrend: (sender, days = 30) => {
    const params = new URLSearchParams({ days });
    if (sender) params.set('sender', sender);
    return apiClient(`/analytics/sentiment-trend?${params}`);
  },

  getCategoryBreakdown: (from, to) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return apiClient(`/analytics/category-breakdown${qs ? `?${qs}` : ''}`);
  },

  searchRAG: (q) => apiClient(`/analytics/rag/search?${new URLSearchParams({ q })}`),

  getReputation: () => apiClient('/analytics/intelligence/reputation'),
};
