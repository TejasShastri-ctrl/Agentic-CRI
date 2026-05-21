import express from 'express';
import pool from '../services/db.js';
import { embedContentWithRetry } from '../services/aiWrapper.js';

const router = express.Router();

// ref url - /analytics/sentiment-trend?sender=X&days=30
// Time-series sentiment data per sender (or global if no sender param)
router.get('/sentiment-trend', async (req, res) => {
  const { sender, days = 30 } = req.query;
  const daysInt = parseInt(days, 10);
  if (isNaN(daysInt) || daysInt < 1) {
    return res.status(400).json({ error_code: 'VALIDATION_ERROR', message: '`days` must be a positive integer.', details: null });
  }

  try {
    const client = await pool.connect();
    try {
      const params = [daysInt];
      let senderClause = '';
      if (sender) {
        params.push(sender);
        senderClause = `AND e.sender = $${params.length}`;
      }

      const result = await client.query(
        `SELECT
           e.sender,
           DATE_TRUNC('day', e.timestamp) AS day,
           ROUND(AVG(e.sentiment_score)::numeric, 3) AS avg_sentiment_score,
           COUNT(*) AS email_count
         FROM emails e
         WHERE e.timestamp >= NOW() - ($1 || ' days')::interval
           AND e.sentiment_score IS NOT NULL
           ${senderClause}
         GROUP BY e.sender, DATE_TRUNC('day', e.timestamp)
         ORDER BY e.sender, day ASC`,
        params
      );

      return res.json({
        status: 'success',
        sender: sender || 'global',
        days: daysInt,
        data: result.rows,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Analytics] sentiment-trend error:', err);
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message, details: null });
  }
});


router.get('/category-breakdown', async (req, res) => {
  const { from, to } = req.query;

  try {
    const client = await pool.connect();
    try {
      const params = [];
      let dateClause = '';

      if (from) {
        params.push(from);
        dateClause += ` AND e.timestamp >= $${params.length}`;
      }
      if (to) {
        params.push(to);
        dateClause += ` AND e.timestamp <= $${params.length}`;
      }

      const result = await client.query(
        `SELECT
           COALESCE(category, 'Unclassified') AS category,
           COUNT(*) AS count,
           ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS percentage
         FROM emails e
         WHERE category IS NOT NULL
           ${dateClause}
         GROUP BY category
         ORDER BY count DESC`,
        params
      );

      return res.json({
        status: 'success',
        from: from || null,
        to: to || null,
        data: result.rows,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Analytics] category-breakdown error:', err);
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message, details: null });
  }
});


router.get('/rag/search', async (req, res) => {
  const { q } = req.query;
  if (!q || !q.trim()) {
    return res.status(400).json({ error_code: 'VALIDATION_ERROR', message: '`q` query parameter is required.', details: null });
  }

  try {
    const embedRes = await embedContentWithRetry({
      model: 'gemini-embedding-001',
      contents: q.trim(),
      config: { outputDimensionality: 768 },
    });
    const embedding = embedRes.embeddings[0].values;

    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT source_doc, chunk_index, chunk_text,
                ROUND((1 - (embedding <=> $1))::numeric, 4) AS similarity
         FROM knowledge_chunks
         ORDER BY embedding <=> $1
         LIMIT 3`,
        [`[${embedding.join(',')}]`]
      );

      return res.json({
        status: 'success',
        query: q,
        results: result.rows,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[RAG] search error:', err);
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message, details: null });
  }
});


router.get('/intelligence/reputation', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT target_entity, source_url, scraped_data, is_stub, scraped_at, expires_at
         FROM web_intelligence_cache
         ORDER BY scraped_at DESC
         LIMIT 10`
      );

      return res.json({
        status: 'success',
        source: result.rows.length > 0 && result.rows[0].is_stub ? 'stub' : 'live',
        data: result.rows,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Intelligence] reputation error:', err);
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: err.message, details: null });
  }
});

export default router;
