import { apiClient } from './client.js';

export const ingestService = {
  ingestEmail: (payload) =>
    apiClient('/api/ingest', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  checkJobStatus: (jobId) => apiClient(`/api/status/${jobId}`),

  agentDryRun: (emailId) =>
    apiClient(`/api/agent/dry-run/${emailId}`, { method: 'POST' }),
};
