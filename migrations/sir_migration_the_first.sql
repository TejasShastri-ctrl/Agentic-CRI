CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

BEGIN;
ROLLBACK;
CREATE TYPE contact_status AS ENUM ('VIP', 'Active', 'Churned', 'Blocked');

CREATE  TYPE subscription_tier AS ENUM ('Free', 'Standard', 'Pro', 'Enterprise');

CREATE TYPE billing_status AS ENUM (
    'Current',
    'Overdue',
    'Suspended'
);

CREATE TYPE thread_status AS ENUM (
    'Open',
    'Resolved',
    'Escalated',
    'Ignored'
);

CREATE TYPE email_status AS ENUM (
    'Received',
    'Processing',
    'Replied',
    'Escalated',
    'Ignored'
);

CREATE TYPE email_category AS ENUM (
    'Complaint',
    'Inquiry',
    'Bug Report',
    'Feature Request',
    'Compliance',
    'Legal',
    'Billing',
    'Spam',
    'Internal',
    'Other'
);

CREATE TYPE urgency_level AS ENUM (
    'Low',
    'Medium',
    'High',
    'Critical'
);

CREATE TYPE sentiment_label AS ENUM (
    'Positive',
    'Neutral',
    'Negative',
    'Mixed'
);

CREATE TYPE action_type AS ENUM (
    'Auto-Reply',
    'Escalate',
    'Legal-Flag',
    'Ticket-Created',
    'Ignored'
);

CREATE TABLE contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    company VARCHAR(255),
    status contact_status NOT NULL DEFAULT 'Active',
    subscription_tier subscription_tier,
    billing_status billing_status NOT NULL DEFAULT 'Current',
    overdue_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,

    account_value DECIMAL(12, 2),
    churn_risk_score FLOAT CHECK (
        churn_risk_score BETWEEN 0 AND 1
    ),

    last_contact_at   TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN contacts.churn_risk_score IS 'Heuristic score 0.0–1.0 computed from sentiment trend + response time + category history. Not a trained model.';

COMMENT ON COLUMN contacts.overdue_amount IS 'Outstanding balance. Seeded from dataset; updated via PATCH /contacts/:email/status.';

CREATE TABLE threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    thread_id VARCHAR(255) UNIQUE NOT NULL,
    subject TEXT,
    sender_email VARCHAR(255) NOT NULL REFERENCES contacts (email) ON UPDATE CASCADE,
    status thread_status NOT NULL DEFAULT 'Open',
    assigned_to VARCHAR(255),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN threads.thread_id IS 'Natural key sourced from the email JSON dataset. Human-readable, e.g. "thread_bob_outage".';

COMMENT ON COLUMN threads.assigned_to IS 'Intentionally free-text. No users table in this system — treated as a string identifier.';

CREATE TABLE emails (
    id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id           VARCHAR(255)  UNIQUE NOT NULL,
    thread_id            VARCHAR(255)  NOT NULL REFERENCES threads(thread_id),
    sender               VARCHAR(255)  NOT NULL REFERENCES contacts(email) ON UPDATE CASCADE,

    subject              TEXT,
    body                 TEXT,
    body_truncated       BOOLEAN       NOT NULL DEFAULT FALSE,
    timestamp            TIMESTAMPTZ   NOT NULL,
    status               email_status  NOT NULL DEFAULT 'Received',

    is_spam BOOLEAN NOT NULL DEFAULT FALSE,
    is_internal BOOLEAN NOT NULL DEFAULT FALSE,
    is_security_flagged BOOLEAN NOT NULL DEFAULT FALSE,
    priority_score urgency_level,
    category email_category,
    sentiment sentiment_label,
    sentiment_score FLOAT CHECK (sentiment_score BETWEEN -1 AND 1),
    urgency urgency_level,
    requires_human BOOLEAN DEFAULT FALSE,
    escalation_reason TEXT,
    suggested_reply TEXT,
    confidence FLOAT CHECK (confidence BETWEEN 0 AND 1),
    raw_entities JSONB,
    job_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

COMMENT ON COLUMN emails.message_id IS 'Natural dedup key from email dataset. Re-ingesting the same message_id returns { deduplicated: true }.';

COMMENT ON COLUMN emails.body_truncated IS 'Set TRUE when original body exceeded 10,000 chars and was truncated to 8,000 before LLM processing.';

COMMENT ON COLUMN emails.is_security_flagged IS 'Set by heuristic filter for ransomware, breach, BTC demands. Emails in this state NEVER reach the LLM or agent.';

COMMENT ON COLUMN emails.priority_score IS 'Heuristic urgency assigned before LLM runs (keyword-based). LLM urgency field may differ.';

COMMENT ON COLUMN emails.raw_entities IS 'Structured entity extraction from LLM: { order_ids: [], ticket_ids: [], monetary_amounts: [], deadlines: [], products_mentioned: [] }';

COMMENT ON COLUMN emails.job_id IS 'pg-boss job ID. Used by GET /api/status/:job_id to return current processing state.';

CREATE TABLE actions (
    id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email_id             UUID         NOT NULL REFERENCES emails(id),
    thread_id            VARCHAR(255) REFERENCES threads(thread_id),

    action_type          action_type  NOT NULL,
    proposed_content     TEXT,

agent_reasoning_log JSONB,

is_approved          BOOLEAN      NOT NULL DEFAULT FALSE,
    approved_by          VARCHAR(255),
    executed_at          TIMESTAMPTZ,

    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN actions.agent_reasoning_log IS 'JSONB array of ReAct steps: [{step: int, thought: str, action: str, args: obj, observation: str, timestamp: str}].';

COMMENT ON COLUMN actions.proposed_content IS 'Draft reply body. NULL for non-reply actions (Escalate, Legal-Flag, Ticket-Created).';

COMMENT ON COLUMN actions.thread_id IS 'Denormalised from emails.thread_id for efficient GET /threads/:contactEmail queries without a JOIN chain.';

CREATE TABLE knowledge_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    source_doc VARCHAR(255) NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    token_count INTEGER,
    embedding vector (1536) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_doc, chunk_index)
);

COMMENT ON COLUMN knowledge_chunks.embedding IS 'Generated by OpenAI text-embedding-3-small. Switching models requires a re-embed migration.';

COMMENT ON COLUMN knowledge_chunks.chunk_index IS 'Zero-based ordinal within source_doc. Used for ordered re-assembly and debugging.';

CREATE TABLE web_intelligence_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    target_entity VARCHAR(255) NOT NULL,
    source_url TEXT,
    scraped_data JSONB NOT NULL,
    is_stub BOOLEAN NOT NULL DEFAULT TRUE,
    scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

COMMENT ON COLUMN web_intelligence_cache.is_stub IS 'TRUE for Phase 8 mock data. GET /intelligence/reputation returns { source: "stub" } when this is TRUE.';

COMMENT ON COLUMN web_intelligence_cache.scraped_data IS 'Schema: { rating: float, reviewCount: int, recentThemes: string[], scrapedAt: ISO8601 }';

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    action VARCHAR(255) NOT NULL,
    performed_by VARCHAR(255),
    diff JSONB,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN audit_log.entity_id IS 'Stored as VARCHAR to support both UUID PKs and natural string keys (e.g. thread_id).';

COMMENT ON COLUMN audit_log.performed_by IS 'Free-text: "agent" for autonomous actions, "system" for pipeline events, user email for human actions.';

COMMENT ON COLUMN audit_log.diff IS 'Optional before/after snapshot: { before: { field: old_value }, after: { field: new_value } }.';

CREATE INDEX idx_contacts_status ON contacts (status);

CREATE INDEX idx_contacts_subscription ON contacts (subscription_tier);

CREATE INDEX idx_contacts_churn_risk ON contacts (churn_risk_score);

CREATE INDEX idx_threads_sender_email ON threads (sender_email);

CREATE INDEX idx_threads_status ON threads (status);

CREATE INDEX idx_threads_last_updated ON threads (last_updated_at DESC);

CREATE INDEX idx_emails_sender ON emails (sender);

CREATE INDEX idx_emails_thread_id ON emails (thread_id);

CREATE INDEX idx_emails_timestamp ON emails (timestamp);

CREATE INDEX idx_emails_sender_timestamp ON emails (sender, timestamp);
CREATE INDEX idx_emails_sentiment_score ON emails (sentiment_score);

CREATE INDEX idx_emails_status ON emails (status);

CREATE INDEX idx_emails_urgency ON emails (urgency);

CREATE INDEX idx_emails_requires_human ON emails (requires_human)
WHERE
    requires_human = TRUE;

CREATE INDEX idx_emails_job_id ON emails (job_id);

CREATE INDEX idx_emails_security_flagged ON emails (is_security_flagged)
WHERE
    is_security_flagged = TRUE;

CREATE INDEX idx_actions_email_id ON actions (email_id);

CREATE INDEX idx_actions_thread_id ON actions (thread_id);

CREATE INDEX idx_actions_action_type ON actions (action_type);

CREATE INDEX idx_actions_is_approved ON actions (is_approved);

CREATE INDEX idx_kb_embedding ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX idx_web_cache_entity ON web_intelligence_cache (target_entity);

CREATE INDEX idx_web_cache_expires ON web_intelligence_cache (expires_at);

CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id);

CREATE INDEX idx_audit_timestamp ON audit_log (timestamp DESC);

CREATE INDEX idx_audit_performed_by ON audit_log (performed_by);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_contacts_updated_at
    BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_threads_last_updated
    BEFORE UPDATE ON threads
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;