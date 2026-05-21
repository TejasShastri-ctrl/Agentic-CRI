import { apiClient } from './client.js';

export const contactsService = {
  getContact: (email) => apiClient(`/contacts/${encodeURIComponent(email)}`),
  updateStatus: (email, status) =>
    apiClient(`/contacts/${encodeURIComponent(email)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
};
