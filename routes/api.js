import express from 'express';
import { z } from 'zod';
import pool from '../services/db.js';
import boss from '../services/boss.js';
import { runPreFilter } from '../services/prefilter.js';

const router = express.Router();

// validation schema
const emailSchema = z.object({
  message_id: z.string().min(1),
  sender: z.string().email(),
  subject: z.string().min(1, "Subject cannot be empty").default("(No Subject)"),
  body: z.string().min(1, "Body cannot be empty"),
  timestamp: z.string().datetime(),
  thread_id: z.string().min(1)
});

// strippin HTML, normalizing whitespace
function sanitizeBody(rawBody) {
  let clean = rawBody.replace(/<[^>]*>?/gm, ''); // crude HTML strip
  clean = clean.trim();
  // Truncate to 10k chars to prevent LLM context overflow
  if (clean.length > 10000) {
    clean = clean.substring(0, 10000) + '\n...[TRUNCATED]';
  }
  return clean;
}

router.post('/ingest', async (req, res) => {
  try {
    const parsed = emailSchema.parse(req.body);

    const cleanBody = sanitizeBody(parsed.body);
    if (!cleanBody) {
      return res.status(400).json({ error_code: 'BAD_REQUEST', message: 'Email body is empty after stripping HTML.' });
    }
    const preFilterResult = runPreFilter({
      sender: parsed.sender,
      subject: parsed.subject,
      body: cleanBody
    });

    const client = await pool.connect();
    let emailId = null;

    try {
      await client.query('BEGIN');

      // 3.5 Upsert Contact to satisfy threads foreign key
      await client.query(`
        INSERT INTO contacts (email)
        VALUES ($1)
        ON CONFLICT (email) DO UPDATE 
        SET last_contact_at = NOW()
      `, [parsed.sender]);

      //!! upsert thread 
      const threadRes = await client.query(`
        INSERT INTO threads (thread_id, subject, sender_email, status)
        VALUES ($1, $2, $3, 'Open')
        ON CONFLICT (thread_id) DO UPDATE 
        SET last_updated_at = NOW()
        RETURNING id
      `, [parsed.thread_id, parsed.subject, parsed.sender]);

      const internalThreadId = threadRes.rows[0].id;

      // 5. Deduplication & Insert
      try {
        const emailRes = await client.query(`
          INSERT INTO emails (
            thread_id, message_id, sender, subject, body, timestamp, 
            urgency, requires_human, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Received')
          RETURNING id
        `, [
          parsed.thread_id,
          parsed.message_id,
          parsed.sender,
          parsed.subject,
          cleanBody,
          parsed.timestamp,
          preFilterResult.initial_urgency,
          preFilterResult.requires_human
        ]);

        emailId = emailRes.rows[0].id;

      } catch (err) {
        if (err.code === '23505') {
          await client.query('ROLLBACK');
          return res.status(200).json({
            status: 'success',
            message: 'Email already processed (idempotent)',
            job_id: null
          });
        }
        throw err;
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    //!! priority queue using pg-boss
    let jobId = null;
    if (!preFilterResult.is_spam && !preFilterResult.is_internal) {
      // High priority for security/critical
      const priority = preFilterResult.initial_urgency === 'Critical' ? 100 : 0;
      jobId = await boss.send('email-classification', { emailId: emailId }, { priority });
    }

    return res.status(200).json({
      status: 'success',
      email_id: emailId,
      job_id: jobId,
      pre_filter: preFilterResult
    });

  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error_code: 'VALIDATION_ERROR',
        message: 'Invalid email payload',
        details: err.errors
      });
    }
    console.error('Ingestion Error:', err);
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message });
  }
});

export default router;