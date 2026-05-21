import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5431,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kbDir = path.join(__dirname, '..', 'kb');
// simple overlapping chunking.
// 1 token = 4 chars, so 400 token ~ 1600 chars overlap
function chunkText(text, maxChars = 1600, overlapChars = 200) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = i + maxChars;
    // try to find a natural break like a newline or period if we are not at the end
    if (end < text.length) {
      const nextNewline = text.lastIndexOf('\n', end);
      const nextPeriod = text.lastIndexOf('.', end);
      const breakPoint = Math.max(nextNewline, nextPeriod);
      if (breakPoint > i) {
        end = breakPoint + 1;
      }
    }
    const chunk = text.slice(i, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    i = end - overlapChars;
    // ploy to ensure its always forward to avoid infinite loops
    if (i <= text.length - maxChars && end - overlapChars <= i) {
      i = end - overlapChars > i ? end - overlapChars : end;
    }
  }
  return chunks;
}

async function seedKB() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY in .env");
    process.exit(1);
  }

  const files = fs.readdirSync(kbDir).filter(f => f.endsWith('.md'));
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE knowledge_chunks');

    let totalChunks = 0;

    for (const file of files) {
      const filePath = path.join(kbDir, file);
      const text = fs.readFileSync(filePath, 'utf-8');
      const chunks = chunkText(text);

      console.log(`Processing ${file}: generated ${chunks.length} chunks.`);

      for (let index = 0; index < chunks.length; index++) {
        const chunkContent = chunks[index];
        // Approximate token count
        const tokenCount = Math.ceil(chunkContent.length / 4);

        const response = await ai.models.embedContent({
          model: "gemini-embedding-001",
          contents: chunkContent,
          config: {
            outputDimensionality: 768
          }
        });
        const embedding = response.embeddings[0].values;

        // Insert into database
        await client.query(
          `INSERT INTO knowledge_chunks (source_doc, chunk_index, chunk_text, token_count, embedding)
           VALUES ($1, $2, $3, $4, $5)`,
          [file, index, chunkContent, tokenCount, `[${embedding.join(',')}]`]
        );
        totalChunks++;
      }
    }

    await client.query('COMMIT');
    console.log(`\nKB Seeding Complete: Successfully embedded and stored ${totalChunks} chunks.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to seed KB:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

seedKB();