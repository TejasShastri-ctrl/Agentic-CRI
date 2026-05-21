
import { generateContentWithRetry, embedContentWithRetry } from '../services/aiWrapper.js';
import pool from '../services/db.js';
import dotenv from 'dotenv';

dotenv.config();


//! imp note here :- The Re-Act loop inserts a single actions row at the end with the full agent_reasoning_log JSONB — this keeps one clean trace per agent run.
// agents by themselves arent allowed to insert the actions table

export const TOOLS = {

  // RAG search across knowledge base
  search_knowledge_base: {
    description: 'Search internal policy documents via RAG. Returns top-3 relevant chunks with source doc names and similarity scores.',
    params: { query: 'string — the search query text' },
    needsEmailId: false,
    fn: async ({ query }) => {
      const embedRes = await embedContentWithRetry({
        model: 'gemini-embedding-001',
        contents: query,
        config: { outputDimensionality: 768 },
      });
      const embedding = embedRes.embeddings[0].values;
      const client = await pool.connect();
      try {
        const res = await client.query(
          `SELECT source_doc, chunk_text, 1 - (embedding <=> $1) AS similarity
           FROM knowledge_chunks
           ORDER BY embedding <=> $1
           LIMIT 3`,
          [`[${embedding.join(',')}]`]
        );
        if (res.rows.length === 0) return 'No relevant knowledge chunks found.';
        return res.rows
          .map(
            (r, i) =>
              `[${i + 1}] SOURCE: ${r.source_doc} (similarity: ${parseFloat(r.similarity).toFixed(3)})\n${r.chunk_text}`
          )
          .join('\n\n---\n\n');
      } finally {
        client.release();
      }
    },
  },

  // Full thread history for a sender
  get_thread_history: {
    description: 'Retrieve full email thread history for a sender, ordered by timestamp ascending. Includes sentiment and status per email.',
    params: { sender_email: 'string — the sender email address' },
    needsEmailId: false,
    fn: async ({ sender_email }) => {
      const client = await pool.connect();
      try {
        const res = await client.query(
          `SELECT e.message_id, e.subject, e.body, e.timestamp,
                  e.sentiment, e.category, e.status, e.suggested_reply
           FROM emails e
           JOIN threads t ON t.thread_id = e.thread_id
           WHERE t.sender_email = $1
           ORDER BY e.timestamp ASC`,
          [sender_email]
        );
        if (res.rows.length === 0) return `No thread history found for ${sender_email}.`;
        return res.rows
          .map(
            (r) =>
              `[${new Date(r.timestamp).toISOString()}] ${r.subject} | Status: ${r.status} | Sentiment: ${r.sentiment || 'unclassified'}\n${(r.body || '').substring(0, 150)}${(r.body || '').length > 150 ? '...' : ''}${r.suggested_reply ? `\n  → Reply sent: ${r.suggested_reply.substring(0, 100)}...` : '\n  → No reply sent'}`
          )
          .join('\n\n---\n\n');
      } finally {
        client.release();
      }
    },
  },

  // CRM contact profile
  get_contact_profile: {
    description: 'Fetch CRM profile: name, company, VIP/status, account value, churn risk score, open thread count.',
    params: { email: 'string — contact email address' },
    needsEmailId: false,
    fn: async ({ email }) => {
      const client = await pool.connect();
      try {
        const res = await client.query(
          `SELECT c.name, c.company, c.status, c.subscription_tier,
                  c.billing_status, c.account_value, c.churn_risk_score,
                  c.overdue_amount, c.last_contact_at,
                  COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'Open') AS open_threads
           FROM contacts c
           LEFT JOIN threads t ON t.sender_email = c.email
           WHERE c.email = $1
           GROUP BY c.id`,
          [email]
        );
        if (res.rows.length === 0) return `No contact profile found for ${email}.`;
        return JSON.stringify(res.rows[0], null, 2);
      } finally {
        client.release();
      }
    },
  },

  // Billing / subscription status
  check_account_status: {
    description: 'Check billing status, subscription tier, and overdue invoice amount for a contact.',
    params: { email: 'string — contact email address' },
    needsEmailId: false,
    fn: async ({ email }) => {
      const client = await pool.connect();
      try {
        const res = await client.query(
          `SELECT billing_status, subscription_tier, overdue_amount, account_value
           FROM contacts WHERE email = $1`,
          [email]
        );
        if (res.rows.length === 0) return `No account found for ${email}.`;
        return JSON.stringify(res.rows[0], null, 2);
      } finally {
        client.release();
      }
    },
  },

  // LLM-powered reply drafting
  draft_reply: {
    description: 'Generate a contextual reply citing specific policies. Returns the draft reply text.',
    params: {
      context: 'string — situation summary and what the reply must address',
      tone: 'string — one of: empathetic | professional | urgent',
      policy_refs: 'string — specific policies to cite (e.g. "refund_policy.md: 14-day window")',
    },
    needsEmailId: false,
    fn: async ({ context, tone, policy_refs }) => {
      const prompt = `You are a professional customer support agent for an AI SaaS company.
        Draft a ${tone} reply to a customer based on the following:

        SITUATION:
        ${context}

        POLICIES TO APPLY AND CITE:
        ${policy_refs}

        REQUIREMENTS:
        - Tone: ${tone}
        - Cite specific policy details inline (e.g. exact refund window, SLA credit formula, GDPR 30-day response window)
        - Do NOT admit legal liability or make promises beyond stated policy
        - Do NOT include greetings like "Dear [Name]" — start with the substance
        - Keep it under 200 words
        - Address the customer's core concern directly

        Reply:`;

      const res = await generateContentWithRetry({
        model: 'gemini-2.5-flash-lite',
        contents: prompt,
        config: { temperature: 0.3 },
      });
      const text = typeof res.text === 'function' ? res.text() : res.text;
      return text.trim();
    },
  },

  // Escelation
  escalate_to_human: {
    description: 'Route the email to a human agent with a pre-filled escalation brief. Updates email status to Escalated.',
    params: {
      reason: 'string — detailed reason for escalation (include key context)',
      priority: 'string — one of: Low | Medium | High | Critical',
    },
    needsEmailId: true,
    fn: async ({ email_id, reason, priority }) => {
      const client = await pool.connect();
      try {
        await client.query(
          `UPDATE emails
           SET requires_human = true, status = 'Escalated',
               escalation_reason = COALESCE(escalation_reason || ' | ', '') || $2
           WHERE id = $1`,
          [email_id, `[${priority}] ${reason}`]
        );
        await client.query(
          `INSERT INTO audit_log (entity_type, entity_id, action, performed_by, diff)
           VALUES ('email', $1, 'escalate_to_human', 'agent', $2::jsonb)`,
          [email_id, JSON.stringify({ reason, priority })]
        );
        return `Escalated to human with priority ${priority}. Brief: ${reason}`;
      } finally {
        client.release();
      }
    },
  },

  //Flag for legal team
  flag_for_legal: {
    description: 'Route legal threats or compliance issues to the legal team per escalation matrix. Sets category to Legal.',
    params: {
      issue_type:
        'string — e.g. "legal threat", "GDPR Article 20 data portability", "cease and desist", "ransomware extortion"',
    },
    needsEmailId: true,
    fn: async ({ email_id, issue_type }) => {
      const client = await pool.connect();
      try {
        await client.query(
          `UPDATE emails
           SET requires_human = true, category = 'Legal', status = 'Escalated'
           WHERE id = $1`,
          [email_id]
        );
        await client.query(
          `INSERT INTO audit_log (entity_type, entity_id, action, performed_by, diff)
           VALUES ('email', $1, 'flag_for_legal', 'agent', $2::jsonb)`,
          [email_id, JSON.stringify({ issue_type })]
        );
        return `Flagged for legal team. Issue type: "${issue_type}". Category set to Legal, email escalated.`;
      } finally {
        client.release();
      }
    },
  },

  // Internal ticket creation
  create_internal_ticket: {
    description: 'Create an internal support or engineering ticket for follow-up by a team.',
    params: {
      title: 'string — ticket title',
      body: 'string — ticket description / details',
      assignee: 'string — team to assign, e.g. "compliance-team", "engineering", "support-lead"',
    },
    needsEmailId: true,
    fn: async ({ email_id, title, body, assignee }) => {
      const client = await pool.connect();
      try {
        const res = await client.query(
          `INSERT INTO actions (email_id, action_type, proposed_content, is_approved, approved_by)
           VALUES ($1, 'Ticket-Created', $2, false, $3)
           RETURNING id`,
          [email_id, `[TICKET] ${title}\n\nAssigned to: ${assignee}\n\n${body}`, assignee]
        );
        await client.query(
          `INSERT INTO audit_log (entity_type, entity_id, action, performed_by, diff)
           VALUES ('email', $1, 'create_internal_ticket', 'agent', $2::jsonb)`,
          [email_id, JSON.stringify({ title, assignee })]
        );
        return `Internal ticket created: "${title}" assigned to ${assignee}. Action ID: ${res.rows[0].id}`;
      } finally {
        client.release();
      }
    },
  },

  // Web intelligence / public sentiment(MOCK SCRAPER for now)
  scrape_public_sentiment: {
    description: 'Fetch public reputation data (G2/Trustpilot) for a company. Returns cached data or stub if scraper not yet live.',
    params: { company_name: 'string — company name to look up' },
    needsEmailId: false,
    fn: async ({ company_name }) => {
      const client = await pool.connect();
      try {
        // Check cache first (6-hour TTL)
        const cacheRes = await client.query(
          `SELECT scraped_data, is_stub, scraped_at
           FROM web_intelligence_cache
           WHERE target_entity = $1 AND expires_at > NOW()
           ORDER BY scraped_at DESC LIMIT 1`,
          [company_name]
        );
        if (cacheRes.rows.length > 0) {
          const r = cacheRes.rows[0];
          const label = r.is_stub ? 'STUB DATA' : 'LIVE DATA';
          return `[${label} for "${company_name}" — cached at ${new Date(r.scraped_at).toISOString()}]\n${JSON.stringify(r.scraped_data, null, 2)}`;
        }
        // Cache miss — write stub. Would need to replace with a real scraper but this would suffice for now
        const stub = {
          rating: 4.2,
          reviewCount: 847,
          recentThemes: ['slow support response', 'pricing concerns', 'missing features'],
          scrapedAt: new Date().toISOString(),
          source: 'stub',
        };
        await client.query(
          `INSERT INTO web_intelligence_cache (target_entity, scraped_data, is_stub, expires_at)
           VALUES ($1, $2::jsonb, true, NOW() + INTERVAL '6 hours')`,
          [company_name, JSON.stringify(stub)]
        );
        return `[STUB DATA for "${company_name}" — real scraper not yet implemented (Phase 11)]\n${JSON.stringify(stub, null, 2)}`;
      } finally {
        client.release();
      }
    },
  },

  // Send auto-reply — BLOCKED at dispatcher for Critical urgency
  send_auto_reply: {
    description:
      'Approve and send an auto-reply to the customer. IMPORTANT: This tool is automatically BLOCKED for Critical urgency emails — use escalate_to_human instead.',
    params: {
      reply_content: 'string — the full reply text to send to the customer',
    },
    needsEmailId: true,
    fn: async ({ email_id, reply_content }) => {
      const client = await pool.connect();
      try {
        // Double-check urgency in DB (dispatcher already enforces this, but defensive)
        const check = await client.query('SELECT urgency FROM emails WHERE id = $1', [email_id]);
        if (check.rows[0]?.urgency === 'Critical') {
          return 'BLOCKED: Auto-reply is not permitted for Critical urgency emails. Use escalate_to_human.';
        }
        await client.query(
          `UPDATE emails SET status = 'Replied', suggested_reply = $2 WHERE id = $1`,
          [email_id, reply_content]
        );
        await client.query(
          `INSERT INTO audit_log (entity_type, entity_id, action, performed_by)
           VALUES ('email', $1, 'send_auto_reply', 'agent')`,
          [email_id]
        );
        return `Auto-reply sent successfully. Reply: "${reply_content.substring(0, 100)}..."`;
      } finally {
        client.release();
      }
    },
  },
};

// getToolMenu kept for debugging / documentation purposes
export function getToolMenu() {
  return Object.entries(TOOLS)
    .map(([name, t]) => {
      const paramList = Object.entries(t.params)
        .map(([k, v]) => `    - ${k}: ${v}`)
        .join('\n');
      return `• ${name}\n${paramList}\n  → ${t.description}`;
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// TOOL_DECLARATIONS — Gemini FunctionDeclaration objects for native tool use.
// Passed directly to the model via config: { tools: [{ functionDeclarations }] }.
// The model was trained on this format and produces properly typed args objects.
// The fn implementations in TOOLS above are executed by the dispatcher when
// the model returns a functionCall part.
// ---------------------------------------------------------------------------
import { Type } from '@google/genai';

export const TOOL_DECLARATIONS = [
  {
    name: 'search_knowledge_base',
    description:
      'Search internal policy documents (pricing, SLA, refund, API docs, compliance FAQ, escalation matrix) via RAG. Returns top-3 relevant chunks with source document names and similarity scores. Always call this before drafting any reply.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query, e.g. "refund policy 14 days" or "SLA credit calculation formula"',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_thread_history',
    description:
      'Retrieve the complete email thread for a sender, ordered by timestamp ascending. Shows sentiment, status, and whether a reply was sent per email. Use to understand escalation patterns and unanswered emails.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sender_email: {
          type: Type.STRING,
          description: "The sender's email address",
        },
      },
      required: ['sender_email'],
    },
  },
  {
    name: 'get_contact_profile',
    description:
      'Fetch CRM profile: name, company, VIP/Active/Churned/Blocked status, subscription tier, account value, churn risk score (0–1), open thread count.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        email: { type: Type.STRING, description: 'Contact email address' },
      },
      required: ['email'],
    },
  },
  {
    name: 'check_account_status',
    description: 'Check billing status (Current/Overdue/Suspended), subscription tier, and overdue invoice amount for a contact.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        email: { type: Type.STRING, description: 'Contact email address' },
      },
      required: ['email'],
    },
  },
  {
    name: 'draft_reply',
    description:
      'Generate a contextual, policy-grounded customer reply. Requires prior search_knowledge_base call for policy refs. Returns the draft reply text.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        context: {
          type: Type.STRING,
          description: 'Situation summary and what the reply must address',
        },
        tone: {
          type: Type.STRING,
          description: 'Reply tone: empathetic | professional | urgent',
        },
        policy_refs: {
          type: Type.STRING,
          description: 'Exact policy details to cite inline, e.g. "refund_policy.md: no refunds after 14 days; exceptions via support ticket"',
        },
      },
      required: ['context', 'tone', 'policy_refs'],
    },
  },
  {
    name: 'escalate_to_human',
    description:
      'Route email to a human agent with a pre-filled escalation brief. Sets status to Escalated and writes to audit_log. Use for unresolved complex cases, VIP accounts, or when requires_human is already true.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: {
          type: Type.STRING,
          description: 'Detailed reason including key context the human agent needs to act immediately',
        },
        priority: {
          type: Type.STRING,
          description: 'Escalation priority: Low | Medium | High | Critical',
        },
      },
      required: ['reason', 'priority'],
    },
  },
  {
    name: 'flag_for_legal',
    description:
      'Route legal or compliance issues to the legal team per the escalation matrix. Sets email category to Legal. Use for: legal threats, GDPR Article 20 requests, cease and desist, data breach claims, ransomware.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        issue_type: {
          type: Type.STRING,
          description: 'e.g. "GDPR Article 20 data portability request", "legal threat", "cease and desist", "ransomware extortion"',
        },
      },
      required: ['issue_type'],
    },
  },
  {
    name: 'create_internal_ticket',
    description: 'Create an internal support or engineering ticket for team follow-up. Writes a Ticket-Created action row.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Short descriptive ticket title' },
        body: {
          type: Type.STRING,
          description: 'Full ticket description with context and required actions',
        },
        assignee: {
          type: Type.STRING,
          description: 'Team or person: "compliance-team" | "engineering" | "support-lead" | "legal-team"',
        },
      },
      required: ['title', 'body', 'assignee'],
    },
  },
  {
    name: 'scrape_public_sentiment',
    description:
      'Fetch public reputation data (G2/Trustpilot scores, recent review themes) for a company. Returns cached or stub data. Use for reputation-sensitive emails: churn threats, public review threats, PR concerns.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        company_name: {
          type: Type.STRING,
          description: 'Company name to look up, e.g. "RetailCo"',
        },
      },
      required: ['company_name'],
    },
  },
  {
    name: 'send_auto_reply',
    description:
      'Send an approved auto-reply to the customer. BLOCKED by dispatcher for Critical urgency — use escalate_to_human instead. Only call after draft_reply has produced the content.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reply_content: {
          type: Type.STRING,
          description: 'The complete reply text to send to the customer',
        },
      },
      required: ['reply_content'],
    },
  },
];

