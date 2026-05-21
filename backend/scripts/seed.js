
// Seed script for `contacts` table from email-data-advanced.json.

//  Overview:
//  Reads all 60 emails from the dataset -> Extracts unique sender emails + names (parsed from the email address itself)
//  Classifies each contact with realistic seed data:
//  Subscription tier, billing status, account value
//  is_vip / status based on known evaluation sender
//  Upserts into contacts (safe to rERUN, no duplicate rows)

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5431,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const __dirname = dirname(fileURLToPath(import.meta.url));

// I don't know if this type of seeding is acceptable. Perhaps I will look into making it better once(if) I am done with the core functionalities

const KNOWN_CONTACTS = {
  'alice.smith@greenlight-npo.org': {
    name: 'Alice Smith',
    company: 'GreenLight NPO',
    status: 'Active',
    subscription_tier: 'Standard',
    billing_status: 'Current',
    account_value: 1800.00,
    overdue_amount: 0.00,
    churn_risk_score: 0.1,
  },
  'bob.jones@enterprise.net': {
    name: 'Bob Jones',
    company: 'Enterprise Net',
    status: 'VIP',
    subscription_tier: 'Enterprise',
    billing_status: 'Current',
    account_value: 120000.00,
    overdue_amount: 0.00,
    churn_risk_score: 0.65,  // SLA breach + legal involvement → elevated risk
  },
  'karen.w@retail-co.com': {
    name: 'Karen W',
    company: 'Retail Co',
    status: 'Active',
    subscription_tier: 'Pro',
    billing_status: 'Current',
    account_value: 3600.00,
    overdue_amount: 0.00,
    churn_risk_score: 0.85,  // 3 unanswered emails + churn threat
  },
  'marcus.del@fintech-startup.co': {
    name: 'Marcus Del',
    company: 'Fintech Startup',
    status: 'Active',
    subscription_tier: 'Standard',
    billing_status: 'Current',
    account_value: 2400.00,
    overdue_amount: 0.00,
    churn_risk_score: 0.2,
  },
  'user.confused@hotmail.com': {
    name: 'Confused User',
    company: null,
    status: 'Active',
    subscription_tier: 'Standard',
    billing_status: 'Current',
    account_value: 299.00,
    overdue_amount: 0.00,
    churn_risk_score: 0.45,
  },
  'hacker@anon-collective.net': {
    name: 'Unknown',
    company: null,
    status: 'Blocked',
    subscription_tier: null,
    billing_status: 'Current',
    account_value: 0.00,
    overdue_amount: 0.00,
    churn_risk_score: null,
  },
  'legal@competitor-corp.com': {
    name: 'Legal Team',
    company: 'Competitor Corp',
    status: 'Blocked',
    subscription_tier: null,
    billing_status: 'Current',
    account_value: 0.00,
    overdue_amount: 0.00,
    churn_risk_score: null,
  },
  'billing@saas-platform.com': {
    name: 'Billing',
    company: 'SaaS Platform',
    status: 'Active',
    subscription_tier: 'Pro',
    billing_status: 'Overdue',
    account_value: 1240.00,
    overdue_amount: 1240.00,
    churn_risk_score: 0.5,
  },
  'eleanor.voss@healthcare-group.org': {
    name: 'Eleanor Voss',
    company: 'Healthcare Group',
    status: 'Active',
    subscription_tier: null,     // prospect — not yet a customer
    billing_status: 'Current',
    account_value: 0.00,         // potential 200-seat deal
    overdue_amount: 0.00,
    churn_risk_score: 0.0,
  },
  'procurement@bigcorp-global.com': {
    name: 'Procurement Team',
    company: 'BigCorp Global',
    status: 'VIP',
    subscription_tier: 'Enterprise',
    billing_status: 'Current',
    account_value: 2400000.00,   // $2.4M RFP
    overdue_amount: 0.00,
    churn_risk_score: 0.1,
  },
};


function nameFromEmail(email) {
  const local = email.split('@')[0];
  return local
    .split(/[._-]/)
    .filter((part) => !/^\d+$/.test(part))   // skip purely numeric parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function companyFromEmail(email) {
  const domain = email.split('@')[1];
  const name = domain.split('.')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function seed() {
  const dataPath = join(__dirname, '..', 'email-data-advanced.json');
  const emails = JSON.parse(readFileSync(dataPath, 'utf8'));

  // Deduplicate by sender email — we only need one contact row per sender.
  const uniqueSenders = [...new Map(emails.map((e) => [e.sender, e])).values()];
  console.log(`Found ${uniqueSenders.length} unique senders in dataset`);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let inserted = 0;
    let skipped = 0;

    for (const email of uniqueSenders) {
      const override = KNOWN_CONTACTS[email.sender] || {};

      const contact = {
        email: email.sender,
        name: override.name ?? nameFromEmail(email.sender),
        company: override.company ?? companyFromEmail(email.sender),
        status: override.status ?? 'Active',
        subscription_tier: override.subscription_tier ?? 'Free',
        billing_status: override.billing_status ?? 'Current',
        account_value: override.account_value ?? null,
        overdue_amount: override.overdue_amount ?? 0.00,
        churn_risk_score: override.churn_risk_score ?? null,
      };

      // ON CONFLICT DO NOTHING — safe to re-run the seed script multiple times.
      const result = await client.query(
        `INSERT INTO contacts
           (email, name, company, status, subscription_tier, billing_status,
            account_value, overdue_amount, churn_risk_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (email) DO NOTHING`,
        [
          contact.email,
          contact.name,
          contact.company,
          contact.status,
          contact.subscription_tier,
          contact.billing_status,
          contact.account_value,
          contact.overdue_amount,
          contact.churn_risk_score,
        ]
      );

      if (result.rowCount > 0) {
        inserted++;
        console.log(`  ✓ ${contact.email} (${contact.status} / ${contact.subscription_tier})`);
      } else {
        skipped++;
        console.log(`  ~ ${contact.email} already exists, skipped`);
      }
    }

    await client.query('COMMIT');
    console.log(`\nSeed complete: ${inserted} inserted, ${skipped} skipped`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed, transaction rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
