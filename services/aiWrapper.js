import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function generateContentWithRetry(options) {
  let attempt = 0;
  while (true) {
    try {
      return await ai.models.generateContent(options);
    } catch (error) {
      attempt++;
      if (attempt > MAX_RETRIES) {
        throw error;
      }
      
      const status = error.status || error.code || 500;
      // Retry on 429 (Too Many Requests) or 503 (Service Unavailable)
      if (status === 429 || status === 503 || status === 'RESOURCE_EXHAUSTED' || status === 'UNAVAILABLE') {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[AI Wrapper] Gemini API returned ${status}. Retrying in ${delay}ms... (Attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }
}

export async function embedContentWithRetry(options) {
  let attempt = 0;
  while (true) {
    try {
      return await ai.models.embedContent(options);
    } catch (error) {
      attempt++;
      if (attempt > MAX_RETRIES) {
        throw error;
      }
      
      const status = error.status || error.code || 500;
      if (status === 429 || status === 503 || status === 'RESOURCE_EXHAUSTED' || status === 'UNAVAILABLE') {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[AI Wrapper] Gemini API returned ${status}. Retrying in ${delay}ms... (Attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }
}
