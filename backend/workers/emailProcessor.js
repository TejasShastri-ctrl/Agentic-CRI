import { Type } from '@google/genai';
import { generateContentWithRetry, embedContentWithRetry } from '../services/aiWrapper.js';
import pool from '../services/db.js';
import { getBoss } from '../services/boss.js';
import { runAgent } from '../agents/ReasonAct.js';
import dotenv from 'dotenv';

dotenv.config();

const schema = {
  type: Type.OBJECT,
  properties: {
    category: { type: Type.STRING, enum: ['Complaint', 'Inquiry', 'Bug Report', 'Feature Request', 'Compliance', 'Legal', 'Billing', 'Spam', 'Internal', 'Other'] },
    sentiment: { type: Type.STRING, enum: ['Positive', 'Neutral', 'Negative', 'Mixed'] },
    sentiment_score: { type: Type.NUMBER },
    urgency: { type: Type.STRING, enum: ['Critical', 'High', 'Medium', 'Low'] },
    requires_human: { type: Type.BOOLEAN },
    escalation_reason: { type: Type.STRING, nullable: true },
    suggested_reply: { type: Type.STRING, nullable: true },
    confidence: { type: Type.NUMBER },
    raw_entities: {
      type: Type.OBJECT,
      properties: {
        order_ids: { type: Type.ARRAY, items: { type: Type.STRING } },
        ticket_ids: { type: Type.ARRAY, items: { type: Type.STRING } },
        monetary_amounts: { type: Type.ARRAY, items: { type: Type.NUMBER } },
        deadlines: { type: Type.ARRAY, items: { type: Type.STRING } },
        products_mentioned: { type: Type.ARRAY, items: { type: Type.STRING } }
      }
    }
  },
  required: ['category', 'sentiment', 'sentiment_score', 'urgency', 'requires_human', 'confidence', 'raw_entities']
};

export async function startEmailProcessor() {
  const boss = await getBoss();

  await boss.work('email-classification', { teamSize: 1, teamConcurrency: 1 }, async (job) => {
    const { emailId } = job.data;
    const client = await pool.connect();

    try {
      // email and thread context
      const emailRes = await client.query('SELECT * FROM emails WHERE id = $1', [emailId]);
      if (emailRes.rows.length === 0) return;
      const email = emailRes.rows[0];

      // Update status to processing
      await client.query('UPDATE emails SET status = $1 WHERE id = $2', ['Processing', email.id]);

      const threadRes = await client.query('SELECT subject, body, sender, timestamp FROM emails WHERE thread_id = $1 ORDER BY timestamp ASC', [email.thread_id]);
      const threadHistory = threadRes.rows.map(r => `[${new Date(r.timestamp).toISOString()}] From ${r.sender}: ${r.subject}\n${r.body}`).join('\n\n---\n\n');

      // Get relevant knowledge chunks
      const embedRes = await embedContentWithRetry({
        model: "gemini-embedding-001",
        contents: email.body,
        config: { outputDimensionality: 768 }
      });
      const embedding = embedRes.embeddings[0].values;

      const ragRes = await client.query(`
        SELECT chunk_text, source_doc, 1 - (embedding <=> $1) AS similarity
        FROM knowledge_chunks
        ORDER BY embedding <=> $1
        LIMIT 3
      `, [`[${embedding.join(',')}]`]);
      const ragContext = ragRes.rows.map((r, i) => `--- POLICY DOCUMENT ${i + 1} (${r.source_doc}) ---\n${r.chunk_text}`).join('\n\n');

      // 3. LLM Classification using Structured Outputs
      const prompt = `
      You are an elite AI assistant classifying customer support emails for an Agentic CRM.
      
      === THREAD HISTORY ===
      ${threadHistory}
      
      === RELEVANT RAG POLICY ===
      ${ragContext}
      
      Task: Analyze the latest email in the thread and classify it. Extract entities, and draft a professional suggested reply based on the policy context.
      If the user is extremely frustrated or angry, grade the sentiment negatively and ensure appropriate urgency.
      `;

      console.log(`[Worker] Classifying Email ID: ${email.message_id}...`);

      const aiRes = await generateContentWithRetry({
        model: 'gemini-2.5-flash-lite',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.1
        }
      });

      const responseText = typeof aiRes.text === 'function' ? aiRes.text() : aiRes.text;
      const parsed = JSON.parse(responseText);

      let requires_human = parsed.requires_human;
      let escalation_reason = parsed.escalation_reason || null;

      if (parsed.confidence < 0.70) {
        requires_human = true;
        const msg = `Low confidence classification (${parsed.confidence.toFixed(2)} < 0.70 threshold)`;
        escalation_reason = escalation_reason ? `${escalation_reason} | ${msg}` : msg;
        console.log(`[Worker] ⚠️ Low confidence for ${email.message_id}: ${parsed.confidence.toFixed(2)}`);
      }

      //Sentiment Trend Tracking (last 2 + this one)
      const sentimentHistoryRes = await client.query(`
        SELECT sentiment FROM emails 
        WHERE sender = $1 AND id != $2 AND sentiment IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT 2
      `, [email.sender, email.id]);

      const pastSentiments = sentimentHistoryRes.rows.map(r => r.sentiment);
      if (parsed.sentiment === 'Negative' && pastSentiments.length === 2 && pastSentiments.every(s => s === 'Negative')) {
        requires_human = true;
        const msg = 'Sentiment deterioration alert (3+ consecutive negative emails)';
        escalation_reason = escalation_reason ? `${escalation_reason} | ${msg}` : msg;
        console.log(`[Worker] 🚨 Escalation Triggered for ${email.sender}: ${msg}`);
      }

      // db update
      const finalStatus = requires_human ? 'Escalated' : 'Replied';
      await client.query(`
        UPDATE emails 
        SET category = $1, sentiment = $2, sentiment_score = $3, urgency = $4,
            requires_human = $5, escalation_reason = $6, suggested_reply = $7,
            confidence = $8, raw_entities = $9, status = $10, processed_at = NOW()
        WHERE id = $11
      `, [
        parsed.category, parsed.sentiment, parsed.sentiment_score, parsed.urgency,
        requires_human, escalation_reason, parsed.suggested_reply,
        parsed.confidence, parsed.raw_entities, finalStatus, email.id
      ]);

      console.log(`[Worker] ✅ Classified ${email.message_id} → Category: ${parsed.category}, Sentiment: ${parsed.sentiment}, Status: ${finalStatus}`);

      // react loop
      try {
        await runAgent(email.id, false, ragContext);
      } catch (agentErr) {
        console.error(`[Worker] ❌ Agent loop failed for ${email.message_id}:`, agentErr.message);
      }

    } catch (e) {
      console.error(`[Worker] ❌ Failed to process job ${job.id}`, e);
      // Wait for boss to auto-retry
      throw e;
    } finally {
      client.release();
    }
  });
}
