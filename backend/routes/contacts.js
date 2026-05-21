import express from 'express';
import { z } from 'zod';
import pool from '../services/db.js';

const router = express.Router();

// Full contact profile with churn risk, account value, and open thread summary
router.get('/:email', async (req, res) => {
  const { email } = req.params;
  try {
    const client = await pool.connect();
    try {
      const contactRes = await client.query(
        `SELECT email, name, company, status, subscription_tier, billing_status,
                overdue_amount, account_value, churn_risk_score, last_contact_at, created_at
         FROM contacts
         WHERE email = $1`,
        [email]
      );

      if (contactRes.rows.length === 0) {
        return res.status(404).json({
          error_code: 'NOT_FOUND',
          message: `No contact found for email: ${email}`,
          details: null,
        });
      }

      // Fetch open thread counts and last activity
      const threadsRes = await client.query(
        `SELECT t.thread_id, t.subject, t.status, t.last_updated_at,
                COUNT(e.id) AS email_count
         FROM threads t
         LEFT JOIN emails e ON e.thread_id = t.thread_id
         WHERE t.sender_email = $1
         GROUP BY t.thread_id, t.subject, t.status, t.last_updated_at
         ORDER BY t.last_updated_at DESC`,
        [email]
      );

      return res.json({
        status: 'success',
        contact: contactRes.rows[0],
        threads: threadsRes.rows,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Contacts] GET error:', err);
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message, details: null });
  }
});

// Update contact status (VIP, Blocked, Active, Churned)
const statusSchema = z.object({
  status: z.enum(['VIP', 'Active', 'Churned', 'Blocked']),
});

router.patch('/:email/status', async (req, res) => {
  const { email } = req.params;
  try {
    const { status } = statusSchema.parse(req.body);
    const client = await pool.connect();
    try {
      const result = await client.query(
        `UPDATE contacts SET status = $1, updated_at = NOW()
         WHERE email = $2
         RETURNING email, name, status`,
        [status, email]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error_code: 'NOT_FOUND',
          message: `No contact found for email: ${email}`,
          details: null,
        });
      }

      // Write to audit log
      await client.query(
        `INSERT INTO audit_log (entity_type, entity_id, action, performed_by, diff)
         VALUES ('contact', $1, 'status_update', 'system', $2::jsonb)`,
        [email, JSON.stringify({ status })]
      );

      return res.json({ status: 'success', contact: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error_code: 'VALIDATION_ERROR', message: 'Invalid status value.', details: err.errors });
    }
    console.error('[Contacts] PATCH status error:', err);
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message, details: null });
  }
});

export default router;
