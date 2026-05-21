import { apiClient } from './client.js';

export const dashboardService = {
  getStats: () => apiClient('/dashboard/stats'),
  getThreads: (email) => apiClient(`/dashboard/threads/${email}`),
};
