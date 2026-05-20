contact table
Represents email senders extracted from the dataset. The primary lookup key
across the system is `email` (natural key). UUID id is for internal joins.
Billing/account fields are seeded from the dataset and used by the
check_account_status() agent tool.

Email semantic category will be set by the LLM classifier.
'Spam' and 'Internal' are included so the category field is always populated,
even for emails caught at the heuristic filter layer (for audit completeness).

One thread per conversation chain. thread_id is the natural key from the
email JSON dataset (e.g. "thread_karen_refund") and is used as the FK target
in emails — keeps queries readable without UUID lookups.

in threads table, assigned_to field is free-text, no users table at the assigned to field for now. THe assignment did not show a users table to I guess it is not expected. I will look into adding actual users if I finish core functionalities first which is the priority.

-- emails
-- Core entity. One row per individual email message.
-- Pre-filter flags (is_spam, is_internal, is_security_flagged) are written
-- BEFORE any LLM call by the heuristic filter. LLM fields are NULL until
-- the classification worker processes the email.
-- job_id links this record to the pg-boss job for GET /api/status/:job_id.


Have to constantly look at the bigger picture while developing this project.