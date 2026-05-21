// scripts/test-agent.js
// Targeted agent test — runs runAgent() directly against a single email
// that is already in the DB (post-classification). Bypasses the full
// ingest → queue → worker pipeline so you can isolate and inspect
// the agent loop output without noise.
//
// Usage:
//   node scripts/test-agent.js                    → dry-run on first classified email
//   node scripts/test-agent.js --live             → live run (writes to DB)
//   node scripts/test-agent.js --id <uuid>        → specific email by ID
//   node scripts/test-agent.js --msgid <msg_id>   → specific email by message_id
//   node scripts/test-agent.js --scenario bob     → find Bob's outage email
//   node scripts/test-agent.js --scenario gdpr    → find GDPR email
//   node scripts/test-agent.js --scenario karen   → find Karen's churn email
//   node scripts/test-agent.js --scenario alice   → find Alice's pricing email

import pg from 'pg';
import dotenv from 'dotenv';
import { runAgent } from '../agents/ReasonAct.js';

dotenv.config();

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Scenario → sender email lookup
const SCENARIOS = {
  bob:   'bob.jones@enterprise.net',
  karen: 'karen.white@retailco.com',
  gdpr:  'privacy@eucompany.com',
  alice: 'alice.johnson@nonprofit.org',
};

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--live');

  const idIdx = args.indexOf('--id');
  const msgIdx = args.indexOf('--msgid');
  const scenarioIdx = args.indexOf('--scenario');

  let emailRow;
  const client = await pool.connect();

  try {
    if (idIdx !== -1) {
      // Direct UUID lookup
      const id = args[idIdx + 1];
      const res = await client.query('SELECT * FROM emails WHERE id = $1', [id]);
      emailRow = res.rows[0];

    } else if (msgIdx !== -1) {
      // message_id lookup
      const msgId = args[msgIdx + 1];
      const res = await client.query('SELECT * FROM emails WHERE message_id = $1', [msgId]);
      emailRow = res.rows[0];

    } else if (scenarioIdx !== -1) {
      // Scenario lookup by sender
      const scenario = args[scenarioIdx + 1];
      const sender = SCENARIOS[scenario];
      if (!sender) {
        console.error(`Unknown scenario "${scenario}". Valid: ${Object.keys(SCENARIOS).join(', ')}`);
        process.exit(1);
      }
      // Get the most recent classified email from this sender
      const res = await client.query(
        `SELECT e.* FROM emails e
         JOIN threads t ON t.thread_id = e.thread_id
         WHERE t.sender_email = $1 AND e.category IS NOT NULL
         ORDER BY e.timestamp DESC LIMIT 1`,
        [sender]
      );
      emailRow = res.rows[0];

    } else {
      // Default: first classified email in DB (status != Received/Processing)
      const res = await client.query(
        `SELECT * FROM emails
         WHERE category IS NOT NULL
         ORDER BY processed_at DESC NULLS LAST, timestamp DESC
         LIMIT 1`
      );
      emailRow = res.rows[0];
    }

    if (!emailRow) {
      console.error('No matching email found. Run reset + replay first to populate the DB.');
      process.exit(1);
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`📧  ${emailRow.message_id}`);
    console.log(`    From    : ${emailRow.sender}`);
    console.log(`    Subject : ${emailRow.subject}`);
    console.log(`    Category: ${emailRow.category || 'unclassified'}`);
    console.log(`    Urgency : ${emailRow.urgency}`);
    console.log(`    Sentiment: ${emailRow.sentiment}`);
    console.log(`    Requires Human: ${emailRow.requires_human}`);
    console.log(`    Mode: ${dryRun ? '🔍 DRY-RUN (no DB writes)' : '🔴 LIVE (writes to DB)'}`);
    console.log('═'.repeat(60) + '\n');

  } finally {
    client.release();
  }

  // Run the agent
  const result = await runAgent(emailRow.id, dryRun);

  // Pretty-print the reasoning trace
  console.log('\n' + '═'.repeat(60));
  console.log(`REASONING TRACE — ${result.steps.length} step(s) → ${result.finalActionType}`);
  console.log('═'.repeat(60));

  for (const step of result.steps) {
    console.log(`\n[Step ${step.step}] ${step.action}`);
    console.log(`  Thought     : ${step.thought?.substring(0, 120)}${(step.thought?.length || 0) > 120 ? '...' : ''}`);
    if (step.args && Object.keys(step.args).length > 0) {
      const argsStr = JSON.stringify(step.args);
      console.log(`  Args        : ${argsStr.substring(0, 120)}${argsStr.length > 120 ? '...' : ''}`);
    }
    console.log(`  Observation : ${step.observation?.substring(0, 200)}${(step.observation?.length || 0) > 200 ? '...' : ''}`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`RESULT: ${result.finalActionType}${result.proposedReply ? ` | Reply: "${result.proposedReply.substring(0, 80)}..."` : ''}`);
  console.log('═'.repeat(60) + '\n');

  await pool.end();
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
