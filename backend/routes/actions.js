import express from 'express';
import { z } from 'zod';
import pool from '../services/db.js';

const router = express.Router();

// POST /respond/:emailId
// Send a human reply. Updates email status to Replied, appends to thread, writes audit log.
const respondSchema = z.object({
  reply_body: z.string().min(1, 'Reply body cannot be empty'),
  performed_by: z.string().email().optional().default('agent'),
});

router.post('/respond/:emailId', async (req, res) => {
  const { emailId } = req.params;
  try {
    const { reply_body, performed_by } = respondSchema.parse(req.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const emailRes = await client.query(
        'SELECT id, message_id, thread_id, status FROM emails WHERE id = $1',
        [emailId]
      );
      if (emailRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error_code: 'NOT_FOUND', message: `Email not found: ${emailId}`, details: null });
      }
      const email = emailRes.rows[0];

      // Update email status to Replied
      await client.query(
        `UPDATE emails SET status = 'Replied', processed_at = NOW() WHERE id = $1`,
        [emailId]
      );

      // Update thread status
      await client.query(
        `UPDATE threads SET status = 'Resolved', last_updated_at = NOW() WHERE thread_id = $1`,
        [email.thread_id]
      );

      // Record the action
      const actionRes = await client.query(
        `INSERT INTO actions (email_id, thread_id, action_type, proposed_content, is_approved, approved_by, executed_at)
         VALUES ($1, $2, 'Auto-Reply', $3, true, $4, NOW())
         RETURNING id`,
        [emailId, email.thread_id, reply_body, performed_by]
      );

      // Audit log
      await client.query(
        `INSERT INTO audit_log (entity_type, entity_id, action, performed_by, diff)
         VALUES ('email', $1, 'human_reply_sent', $2, $3::jsonb)`,
        [emailId, performed_by, JSON.stringify({ reply_body, action_id: actionRes.rows[0].id })]
      );

      await client.query('COMMIT');
      return res.json({ status: 'success', action_id: actionRes.rows[0].id, message: 'Reply sent and thread resolved.' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error_code: 'VALIDATION_ERROR', message: 'Invalid payload.', details: err.errors });
    }
    console.error('[Actions] respond error:', err);
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message, details: null });
  }
});

// PATCH /drafts/:id
// Edit an agent-proposed auto-reply draft before sending
const draftEditSchema = z.object({
  proposed_content: z.string().min(1, 'Draft content cannot be empty'),
});

router.patch('/drafts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { proposed_content } = draftEditSchema.parse(req.body);
    const client = await pool.connect();
    try {
      const result = await client.query(
        `UPDATE actions
         SET proposed_content = $1
         WHERE id = $2 AND is_approved = false
         RETURNING id, email_id, action_type, proposed_content, is_approved`,
        [proposed_content, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error_code: 'NOT_FOUND',
          message: `Draft not found or already approved: ${id}`,
          details: null,
        });
      }

      return res.json({ status: 'success', draft: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error_code: 'VALIDATION_ERROR', message: 'Invalid payload.', details: err.errors });
    }
    console.error('[Actions] draft edit error:', err);
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message, details: null });
  }
});

// POST /drafts/:id/approve
// Approve and send an agent draft. Writes audit log with before/after diff.
const approveSchema = z.object({
  approved_by: z.string().min(1).optional().default('human'),
});

router.post('/drafts/:id/approve', async (req, res) => {
  const { id } = req.params;
  try {
    const { approved_by } = approveSchema.parse(req.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Fetch the draft
      const draftRes = await client.query(
        `SELECT a.id, a.email_id, a.thread_id, a.proposed_content, a.is_approved, a.action_type
         FROM actions a WHERE a.id = $1`,
        [id]
      );

      if (draftRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error_code: 'NOT_FOUND', message: `Draft not found: ${id}`, details: null });
      }

      const draft = draftRes.rows[0];
      if (draft.is_approved) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error_code: 'CONFLICT', message: 'Draft has already been approved.', details: null });
      }

      // Mark draft as approved
      await client.query(
        `UPDATE actions SET is_approved = true, approved_by = $1, executed_at = NOW() WHERE id = $2`,
        [approved_by, id]
      );

      // Update email status to Replied
      await client.query(
        `UPDATE emails SET status = 'Replied', suggested_reply = $1, processed_at = NOW() WHERE id = $2`,
        [draft.proposed_content, draft.email_id]
      );

      // Update thread
      await client.query(
        `UPDATE threads SET status = 'Resolved', last_updated_at = NOW() WHERE thread_id = $1`,
        [draft.thread_id]
      );

      // Audit log with before/after diff
      await client.query(
        `INSERT INTO audit_log (entity_type, entity_id, action, performed_by, diff)
         VALUES ('action', $1, 'draft_approved', $2, $3::jsonb)`,
        [id, approved_by, JSON.stringify({ before: { is_approved: false }, after: { is_approved: true, approved_by } })]
      );

      await client.query('COMMIT');
      return res.json({ status: 'success', message: 'Draft approved and reply sent.', action_id: id });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error_code: 'VALIDATION_ERROR', message: 'Invalid payload.', details: err.errors });
    }
    console.error('[Actions] approve error:', err);
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message, details: null });
  }
});

// GET /audit/:entityType/:entityId
// Full audit history for any entity (email, contact, action, thread)
router.get('/audit/:entityType/:entityId', async (req, res) => {
  const { entityType, entityId } = req.params;
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT id, entity_type, entity_id, action, performed_by, diff, timestamp
         FROM audit_log
         WHERE entity_type = $1 AND entity_id = $2
         ORDER BY timestamp DESC`,
        [entityType, entityId]
      );

      return res.json({
        status: 'success',
        entity_type: entityType,
        entity_id: entityId,
        audit_log: result.rows,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Audit] history error:', err);
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message, details: null });
  }
});

export default router;
