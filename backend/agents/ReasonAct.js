import { generateContentWithRetry } from '../services/aiWrapper.js';
import pool from '../services/db.js';
import { dispatch } from './dispatcher.js';
import { TOOL_DECLARATIONS } from './tools.js';
import dotenv from 'dotenv';

dotenv.config();

const MAX_STEPS = 6;

const TERMINAL_ACTION_TYPE = {
  send_auto_reply: 'Auto-Reply',
  escalate_to_human: 'Escalate',
  flag_for_legal: 'Legal-Flag',
  create_internal_ticket: 'Ticket-Created',
};

export async function runAgent(emailId, dryRun = false, ragContext = null) {

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
    `[Agent] 🤖 Starting — ${email.message_id} | urgency: ${email.urgency} | dryRun: ${dryRun}`
  );

  const systemPrompt = `You are an autonomous AI agent resolving a customer support email for an Agentic CRM platform.

        EMAIL TO RESOLVE:
          Message ID : ${email.message_id}
          From       : ${email.sender}
          Subject    : ${email.subject}
          Body       : ${(email.body || '').substring(0, 1200)}${(email.body || '').length > 1200 ? '\n  ...[truncated]' : ''}

        CLASSIFICATION (completed by Layer 2):
          Category         : ${email.category || 'unclassified'}
          Sentiment        : ${email.sentiment || 'unknown'} (score: ${email.sentiment_score ?? 'N/A'})
          Urgency          : ${email.urgency || 'unknown'}
          Requires Human   : ${email.requires_human}
          Escalation Reason: ${email.escalation_reason || 'none'}

        ${ragContext ? `\n        [PRE-FETCHED KNOWLEDGE BASE CONTEXT]\n        ${ragContext}\n` : ''}

        HARD RULES (enforced in code — your output cannot override these):
          1. Maximum ${MAX_STEPS} tool calls. The system enforces this — plan your steps accordingly.
          2. send_auto_reply is BLOCKED by the dispatcher for Critical urgency emails.
          3. GDPR / legal emails: call flag_for_legal() AND create_internal_ticket() — never send_auto_reply.
          4. If the email urgency is 'Critical' or 'Requires Human' is true, you MUST gather context and immediately call escalate_to_human(). You cannot simply finish.
          5. Use the PRE-FETCHED KNOWLEDGE BASE CONTEXT if available. Only call search_knowledge_base if you need additional specific information before drafting a reply.
          6. IF A TOOL RETURNS AN ERROR (e.g. 503 Unavailable, network error, or invalid arguments), DO NOT proceed with dependent actions like send_auto_reply. You MUST either retry the tool, or call escalate_to_human with the error details. Do not hallucinate successful responses.
          7. When you are finished, respond with a plain-text summary of what you did and why — no more tool calls.`;

  const contents = [{ role: 'user', parts: [{ text: systemPrompt }] }];

  const geminiTools = [{ functionDeclarations: TOOL_DECLARATIONS }];

  // reason and act loop
  const steps = [];
  let finalActionType = 'Ignored';
  let proposedReply = null;
  let resolvedCleanly = false;

  for (let stepNum = 1; stepNum <= MAX_STEPS; stepNum++) {
    let response;
    try {
      response = await generateContentWithRetry({
        model: 'gemini-2.5-flash-lite',
        contents,
        config: {
          tools: geminiTools,
          temperature: 0.2,
        },
      });
    } catch (err) {
      console.error(`[Agent] LLM error at step ${stepNum}:`, err.message);
      steps.push({
        step: stepNum,
        thought: 'LLM call failed — escalating.',
        action: 'FINISH',
        args: {},
        observation: `LLM error: ${err.message}`,
        timestamp: new Date().toISOString(),
      });
      finalActionType = 'Escalate';
      resolvedCleanly = true;
      break;
    }

    const candidate = response.candidates?.[0];
    if (!candidate) {
      console.warn(`[Agent] No candidate returned at step ${stepNum} — stopping`);
      resolvedCleanly = true;
      break;
    }

    const parts = candidate.content?.parts || [];

    const textPart = parts.find((p) => p.text)?.text?.trim() || null;
    const funcPart = parts.find((p) => p.functionCall) || null;

    contents.push({ role: 'model', parts: candidate.content.parts });

    if (!funcPart) {
      const summary = textPart || 'Agent completed without further actions.';
      console.log(`[Agent] ✅ Model finished naturally at step ${stepNum}`);
      steps.push({
        step: stepNum,
        thought: summary,
        action: 'FINISH',
        args: {},
        observation: summary,
        timestamp: new Date().toISOString(),
      });
      resolvedCleanly = true;
      break;
    }

    // Tool call
    const { name: toolName, args } = funcPart.functionCall;
    const thought = textPart || `Calling ${toolName}`;

    console.log(
      `[Agent] Step ${stepNum}: ${toolName} — ${thought.substring(0, 80)}${thought.length > 80 ? '...' : ''}`
    );






    const result = await dispatch(toolName, args, emailId, email.urgency, dryRun);

    steps.push({
      step: stepNum,
      thought,
      action: toolName,
      args,
      observation: result.observation,
      timestamp: new Date().toISOString(),
    });

    if (TERMINAL_ACTION_TYPE[toolName]) {
      finalActionType = TERMINAL_ACTION_TYPE[toolName];
    }

    if (toolName === 'send_auto_reply' && args.reply_content) {
      proposedReply = args.reply_content;
    }

    contents.push({
      role: 'user',
      parts: [{
        functionResponse: {
          name: toolName,
          response: { result: result.observation },
        },
      }],
    });

  }

  if (!resolvedCleanly) {
    const stepsActed = steps.map((s) => s.action).join(' → ');
    const autoReason = `Agent exhausted max tool calls (${MAX_STEPS}) without resolution. Steps taken: ${stepsActed}`;
    console.log(`[Agent] Max steps reached for ${email.message_id} — auto-escalating`);

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
      args: { reason: autoReason, priority: 'High' },
      observation: 'Auto-escalated. Human agent briefed.',
      timestamp: new Date().toISOString(),
    });
    finalActionType = 'Escalate';
  }

  // reasoning log:
  // Single actions row per agent run that contains:
  //   - action_type  → the terminal action taken
  //   - agent_reasoning_log → full JSONB step array (the visible trace)
  //   - proposed_content → reply text (if send_auto_reply was called)
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
    `[Agent] ✅ Completed ${email.message_id} in ${steps.length} step(s) → ${finalActionType}`
  );

  return { emailId, steps, dryRun, finalActionType, proposedReply };
}
