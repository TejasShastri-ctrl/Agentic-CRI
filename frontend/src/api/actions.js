import { apiClient } from './client.js';

export const actionsService = {
  sendReply: (emailId, replyBody, performedBy = 'human') =>
    apiClient(`/respond/${emailId}`, {
      method: 'POST',
      body: JSON.stringify({ reply_body: replyBody, performed_by: performedBy }),
    }),

  editDraft: (draftId, content) =>
    apiClient(`/drafts/${draftId}`, {
      method: 'PATCH',
      body: JSON.stringify({ proposed_content: content }),
    }),

  approveDraft: (draftId, approvedBy = 'human') =>
    apiClient(`/drafts/${draftId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approved_by: approvedBy }),
    }),

  getAuditLog: (entityType, entityId) =>
    apiClient(`/audit/${entityType}/${entityId}`),
};
