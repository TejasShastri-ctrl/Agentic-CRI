import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, '..', 'email-data-advanced.json');

const API_URL = process.env.API_URL || 'http://localhost:3000/api/ingest';
const DELAY_MS = parseInt(process.env.REPLAY_DELAY_MS || '20000', 10);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function replay() {
  console.log(`Loading dataset from ${dataPath}`);
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  console.log(`Loaded ${data.length} emails. Starting replay to ${API_URL} with a ${DELAY_MS}ms delay...`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < data.length; i++) {
    const email = data[i];
    console.log(`[${i + 1}/${data.length}] Sending ${email.message_id} (Thread: ${email.thread_id})`);
    
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(email)
      });

      const body = await res.json();
      
      if (res.ok) {
        console.log(`  -> Success: Job ID ${body.job_id || 'N/A'} (Urgency: ${body.pre_filter?.initial_urgency})`);
        successCount++;
      } else {
        console.error(`  -> Failed [${res.status}]:`, body.message || body);
        failCount++;
      }
    } catch (err) {
      console.error(`  -> Network Error:`, err.message);
      failCount++;
    }

    if (i < data.length - 1) {
      await delay(DELAY_MS);
    }
  }

  console.log(`\nReplay Complete! Success: ${successCount}, Failed: ${failCount}`);
}

replay().catch(console.error);
