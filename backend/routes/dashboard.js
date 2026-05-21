import express from 'express';
import pool from '../services/db.js';

const router = express.Router();


router.get('/stats', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('Received', 'Processing'))        AS pending,
          COUNT(*) FILTER (WHERE status = 'Replied')                          AS replied,
          COUNT(*) FILTER (WHERE status = 'Escalated')                        AS escalated,
          COUNT(*) FILTER (WHERE urgency = 'Critical')                        AS critical,
          COUNT(*) FILTER (WHERE is_spam = TRUE)                              AS spam,
          COUNT(*)                                                             AS total
        FROM emails
      `);
      return res.json({ status: 'success', stats: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Dashboard] stats error:', err);
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message, details: null });
  }
});

// Full conversation thread: all emails, their actions, and agent reasoning logs.
router.get('/threads/:contactEmail', async (req, res) => {
  const { contactEmail } = req.params;
  try {
    const client = await pool.connect();
    try {
      // Fetch thread metadata
      const threadRes = await client.query(
        `SELECT t.id, t.thread_id, t.subject, t.sender_email, t.status, t.assigned_to,
                t.first_seen_at, t.last_updated_at
         FROM threads t
         WHERE t.sender_email = $1
         ORDER BY t.last_updated_at DESC`,
        [contactEmail]
      );

      if (threadRes.rows.length === 0) {
        return res.status(404).json({
          error_code: 'NOT_FOUND',
          message: `No threads found for contact: ${contactEmail}`,
          details: null,
        });
      }

      // For each thread, fetch its emails and actions with reasoning logs
      const threads = await Promise.all(
        threadRes.rows.map(async (thread) => {
          const emailsRes = await client.query(
            `SELECT id, message_id, sender, subject, body, timestamp, status,
                    category, sentiment, sentiment_score, urgency,
                    requires_human, escalation_reason, suggested_reply,
                    confidence, raw_entities, is_spam, is_security_flagged, processed_at
             FROM emails
             WHERE thread_id = $1
             ORDER BY timestamp ASC`,
            [thread.thread_id]
          );

          const actionsRes = await client.query(
            `SELECT id, email_id, action_type, proposed_content,
                    agent_reasoning_log, is_approved, approved_by, executed_at, created_at
             FROM actions
             WHERE thread_id = $1
             ORDER BY created_at ASC`,
            [thread.thread_id]
          );

          return {
            ...thread,
            emails: emailsRes.rows,
            actions: actionsRes.rows,
          };
        })
      );

      return res.json({ status: 'success', contact_email: contactEmail, threads });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Dashboard] threads error:', err);
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message, details: null });
  }
});

export default router;
