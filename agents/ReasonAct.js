// naming this react.js felt a little wrong..

import { GoogleGenAI, Type } from '@google/genai';
import pool from '../services/db.js';
import { dispatch } from './dispatcher.js';
import { getToolMenu } from './tools.js';
import dotenv from 'dotenv';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MAX_STEPS = 6;

// args_json ka type is JSON string and not an object for Gemini structured output compatibility.
const stepSchema = {
  type: Type.OBJECT,
  properties: {
    thought: {
      type: Type.STRING,
      description: 'Your reasoning about what to do next, given all context seen so far.',
    },
    action: {
      type: Type.STRING,
      description:
        'The tool name to call (e.g. "search_knowledge_base"), or "FINISH" if you are done after the last tool has been called.',
    },
    args_json: {
      type: Type.STRING,
      description:
        'JSON string of the arguments to pass to the tool. Use {} if action is FINISH. Example for get_contact_profile: {"email": "user@example.com"}',
    },
    is_final: {
      type: Type.BOOLEAN,
      description:
        'Set to true when this is your final step (i.e. you have just called send_auto_reply or escalate_to_human, or action is FINISH).',
    },
    final_summary: {
      type: Type.STRING,
      nullable: true,
      description: 'Required when is_final=true. A 1–2 sentence summary of what was done and why.',
    },
  },
  required: ['thought', 'action', 'args_json', 'is_final'],
};

// Maps terminal tool calls to the correct actions.action_type ENUM value
const TERMINAL_ACTION_TYPE = {
  send_auto_reply: 'Auto-Reply',
  escalate_to_human: 'Escalate',
  flag_for_legal: 'Legal-Flag',
  create_internal_ticket: 'Ticket-Created',
  FINISH: 'Ignored',
};

export async function runAgent(emailId, dryRun = false) {

  const client = await pool.connect();
  let email;
  try {
    const res = await client.query('SELECT * FROM emails WHERE id = $1', [emailId]);
    if (res.rows.length === 0) throw new Error(`Email not found: ${emailId}`);
    email = res.rows[0];
  } finally {
    client.release();
  }

  console.log(
    `[Agent] 🤖 Starting ReAct loop — ${email.message_id} | urgency: ${email.urgency} | dryRun: ${dryRun}`
  );

  // the react loop
  const steps = [];
  let finalActionType = 'Ignored';
  let proposedReply = null;

  for (let stepNum = 1; stepNum <= MAX_STEPS; stepNum++) {
    const stepsLog =
      steps.length === 0
        ? '(none yet — this is step 1)'
        : steps
            .map(
              (s) =>
                `Step ${s.step}:\n  Thought: ${s.thought}\n  Action: ${s.action}(${s.args_json})\n  Observation: ${s.observation}`
            )
            .join('\n\n');

    const prompt = `You are an autonomous AI agent resolving a customer support email for an Agentic CRM platform.

      EMAIL TO RESOLVE -
      Message ID : ${email.message_id}
      From       : ${email.sender}
      Subject    : ${email.subject}
      Body       : ${(email.body || '').substring(0, 1200)}${(email.body || '').length > 1200 ? '\n...[truncated]' : ''}

      CLASSIFICATION -
      Category         : ${email.category || 'unclassified'}
      Sentiment        : ${email.sentiment || 'unknown'} (score: ${email.sentiment_score ?? 'N/A'})
      Urgency          : ${email.urgency || 'unknown'}
      Requires Human   : ${email.requires_human}
      Escalation Reason: ${email.escalation_reason || 'none'}

      AVAILABLE TOOLS -
      ${getToolMenu()}

      HARD RULES(cannot be overridden) -
      1. You have ${MAX_STEPS - stepNum + 1} tool call(s) remaining including this step. If you cannot resolve in ${MAX_STEPS - stepNum + 1} step(s), set action="FINISH" and explain in final_summary — the system will auto-escalate.
      2. send_auto_reply is BLOCKED for Critical urgency emails by the dispatcher. Do not attempt it.
      3. GDPR / legal emails: always call flag_for_legal() and create_internal_ticket() — never send_auto_reply.
      4. Search the knowledge base before drafting any reply.
      5. Set is_final=true on your last step (after calling send_auto_reply, escalate_to_human, or FINISH).

      STEPS TAKEN SO FAR:
      ${stepsLog}

      Now output your next step as JSON. Remember: args_json must be a valid JSON string.`;

    let parsed;
    try {
      const aiRes = await ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: stepSchema,
          temperature: 0.2,
        },
      });
      const text = typeof aiRes.text === 'function' ? aiRes.text() : aiRes.text;
      parsed = JSON.parse(text);
    } catch (err) {
      console.error(`[Agent] LLM error at step ${stepNum}:`, err.message);
      steps.push({
        step: stepNum,
        thought: 'LLM call failed.',
        action: 'FINISH',
        args_json: '{}',
        observation: `LLM error: ${err.message}`,
        timestamp: new Date().toISOString(),
      });
      finalActionType = 'Escalate';
      break;
    }

    let args = {};
    try {
      args = JSON.parse(parsed.args_json || '{}');
    } catch {
      args = {};
    }

    console.log(
      `[Agent] Step ${stepNum}: ${parsed.action} — ${parsed.thought.substring(0, 80)}...`
    );

    // FINISH handling
    if (parsed.action === 'FINISH' || (parsed.is_final && !TERMINAL_ACTION_TYPE[parsed.action])) {
      steps.push({
        step: stepNum,
        thought: parsed.thought,
        action: 'FINISH',
        args_json: '{}',
        observation: parsed.final_summary || 'Agent completed.',
        timestamp: new Date().toISOString(),
      });
      finalActionType = 'Ignored';
      break;
    }

    // Dispatcher tool
    const result = await dispatch(parsed.action, args, emailId, email.urgency, dryRun);

    const stepRecord = {
      step: stepNum,
      thought: parsed.thought,
      action: parsed.action,
      args_json: parsed.args_json,
      observation: result.observation,
      timestamp: new Date().toISOString(),
    };
    steps.push(stepRecord);

    // Track the best matching action_type from terminal tools
    if (TERMINAL_ACTION_TYPE[parsed.action]) {
      finalActionType = TERMINAL_ACTION_TYPE[parsed.action];
    }

    // Capture reply text if send_auto_reply was called
    if (parsed.action === 'send_auto_reply' && args.reply_content) {
      proposedReply = args.reply_content;
    }

    // Check is_final
    if (parsed.is_final) {
      break;
    }
  }

  // max steps:
  // autoescalation if out of steps without is_final break
  const lastStep = steps[steps.length - 1];
  if (steps.length > 0 && lastStep.action !== 'FINISH' && !lastStep.is_final) {
    const stepsActed = steps.map((s) => s.action).join(' → ');
    const autoReason = `Agent exhausted max tool calls (${MAX_STEPS}) without resolution. Steps: ${stepsActed}`;
    console.log(`[Agent] ⚠️  Max steps reached for ${email.message_id} — auto-escalating`);

    if (!dryRun) {
      await dispatch(
        'escalate_to_human',
        { reason: autoReason, priority: 'High' },
        emailId,
        email.urgency,
        false
      );
    }

    steps.push({
      step: steps.length + 1,
      thought: 'Maximum tool calls reached without resolution. Auto-escalating per system rule.',
      action: 'escalate_to_human [AUTO]',
      args_json: JSON.stringify({ reason: autoReason, priority: 'High' }),
      observation: 'Auto-escalated. Human agent briefed.',
      timestamp: new Date().toISOString(),
    });
    finalActionType = 'Escalate';
  }

  // Persist actions row with full reasoning log
  if (!dryRun) {
    const logClient = await pool.connect();
    try {
      await logClient.query(
        `INSERT INTO actions
           (email_id, thread_id, action_type, agent_reasoning_log, proposed_content, is_approved)
         VALUES ($1, $2, $3, $4::jsonb, $5, false)`,
        [
          emailId,
          email.thread_id,
          finalActionType,
          JSON.stringify(steps),
          proposedReply,
        ]
      );
    } catch (err) {
      console.error('[Agent] Failed to persist reasoning log:', err.message);
    } finally {
      logClient.release();
    }
  }

  console.log(
    `[Agent] Completed ${email.message_id} in ${steps.length} step(s) → ${finalActionType}`
  );

  return { emailId, steps, dryRun, finalActionType, proposedReply };
}
