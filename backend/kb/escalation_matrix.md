# Escalation Matrix

When an AI agent or support representative encounters high-risk scenarios, they must execute the exact protocols below:

## Legal Threats
Any communication threatening a lawsuit, referencing "legal counsel", "cease and desist", or "breach of contract":
- MUST call `flag_for_legal(issue_type: "legal threat")`.
- MUST call `escalate_to_human(priority: "High")`.

## Security Incidents (e.g., Ransomware)
Reports of data breaches, suspicious logins, or ransomware demands (e.g., "send 2 BTC"):
- MUST call `flag_for_legal(issue_type: "ransomware/security")`.
- MUST call `create_internal_ticket(title: "Security Threat", assignee: "security-team")`.
- MUST call `escalate_to_human(priority: "Critical")`.
- NEVER call `draft_reply` or `send_auto_reply`.

## PR Crises & Reputation Threats
Threats to post negative reviews publicly (e.g., Trustpilot, G2, Twitter/X) or churn threats due to severe dissatisfaction:
- MUST call `scrape_public_sentiment()` to assess current reputation.
- MUST call `draft_reply()` to acknowledge the issue and suggest a retention offer.
- MUST call `escalate_to_human(priority: "High")`.

## GDPR Requests
Formal GDPR requests, including "Right to be Forgotten" or "Article 20 Data Portability" requests:
- MUST call `flag_for_legal(issue_type: "GDPR Request")`.
- MUST call `create_internal_ticket(title: "GDPR Request", assignee: "compliance-team")`.
- MUST call `draft_reply()` citing the 30-day statutory window.
- MUST call `send_auto_reply()`.
- Do NOT call `escalate_to_human` for GDPR unless a tool fails.

## Chatbot Misinformation / Discrepancies
If a user reports incorrect information provided by our own AI/chatbot:
- MUST call `search_knowledge_base()` to retrieve the true policy.
- MUST call `draft_reply()` acknowledging the discrepancy without admitting legal liability.
- MUST call `escalate_to_human(priority: "High")` including a summary of chatbot vs actual policy.

## SLA Breach & Critical Outages
For P0 production down scenarios causing significant loss:
- MUST call `get_thread_history()` to establish timeline.
- MUST call `check_account_status()` to verify SLA tier.
- MUST call `flag_for_legal()` if the customer threatens legal action over the SLA breach.
- MUST call `draft_reply()` citing the SLA credit policy.
- MUST call `escalate_to_human(priority: "Critical")`.

## Complex Billing / Conflicting Thread Signals
If the user asks complex pricing or upgrade questions across multiple emails (e.g., pro-rata billing):
- MUST call `get_thread_history()` to read the full context before drafting any replies.
