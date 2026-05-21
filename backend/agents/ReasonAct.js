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

  const systemPrompt = `You are an autonomous background worker resolving a customer support email for an Agentic CRM platform.
        You process emails in a queue without human supervision.
        Do NOT ask questions to the user or ask for permission (e.g., "Would you like me to draft a reply?"). The user cannot hear you or respond during execution. You must act autonomously.

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

        HARD RULES:
          1. Maximum ${MAX_STEPS} tool calls. Plan your steps accordingly.
          2. send_auto_reply is BLOCKED by the dispatcher for Critical urgency emails.
          3. GDPR / Legal Data Portability Requests (e.g. "GDPR Article 20", "right to portability", "data export"):
             MUST execute this EXACT sequence → flag_for_legal(issue_type: "GDPR Request") → create_internal_ticket(assignee: "compliance-team") → draft_reply() citing the 30-day statutory window → send_auto_reply().
             Do NOT call escalate_to_human for GDPR unless a tool fails.
          4. Ransomware / Security Extortion (e.g. "Send 2 BTC", "we have your data", "pay or we publish"):
             MUST execute this EXACT sequence → flag_for_legal(issue_type: "ransomware/security") → create_internal_ticket(title: "Security Threat", assignee: "security-team") → escalate_to_human(priority: "Critical").
             NEVER call draft_reply or send_auto_reply. Any reply to an attacker is strictly forbidden.
          5. Reputation Crisis / Public Review Threats (e.g. "post on Trustpilot", "G2 review", "Twitter/X", or 3+ unanswered emails with churn threat):
             MUST execute this EXACT sequence → scrape_public_sentiment(company_name) → draft_reply() offering a retention offer from the refund policy → escalate_to_human(priority: "High").
          6. Chatbot Misinformation / Discrepancy (e.g. "your chatbot told me", "your AI said", conflicting info from our own system):
             MUST execute this EXACT sequence → search_knowledge_base() for the actual policy → draft_reply() acknowledging the discrepancy WITHOUT admitting legal liability → escalate_to_human(priority: "High") outlining chatbot vs actual policy.
          7. SLA Breach / Outage Escalations (e.g. P0, "production down", "legal team involved", SLA credit claims):
             MUST execute this EXACT sequence → get_thread_history() → check_account_status() → search_knowledge_base() for SLA credit obligations → flag_for_legal() if a legal threat is present → draft_reply() citing SLA credit policy → escalate_to_human(priority: "Critical").
          8. Conflicting Thread Signals / Complex Billing (e.g. pro-rata billing, mid-cycle upgrades, pricing across multiple emails):
             MUST call get_thread_history() to read the full conversation context BEFORE drafting any billing or pricing reply.
          9. Standard Escalation: For any other email where urgency is 'Critical' or 'Requires Human' is true, MUST call escalate_to_human(). You cannot simply finish without calling it.
          10. Use the PRE-FETCHED KNOWLEDGE BASE CONTEXT if available. Only call search_knowledge_base if you need additional specific information not in the pre-fetched context.
          11. IF A TOOL RETURNS AN ERROR, you MUST either retry the tool or call escalate_to_human with the error details. Do not hallucinate successful responses.
          12. To send a reply, you MUST first call draft_reply() to generate the reply text. IMPORTANT: After draft_reply returns the text, your VERY NEXT action MUST be to call send_auto_reply() with that exact text. Never stop after just drafting!
          13. NEVER mock or simulate tool output structures in your thought text (e.g., writing lines that look like tool responses/JSON outputs). You must invoke the actual tool function.
          14. When you are fully finished with all actions (having called send_auto_reply, escalate_to_human, etc.), respond with a final text summary of what you did and why, which will trigger the FINISH action.`;

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
    if (!candidate || !candidate.content) {
      console.warn(`[Agent] No valid content returned at step ${stepNum} — stopping. Reason: ${candidate?.finishReason}`);
      resolvedCleanly = false;
      break;
    }

    const parts = candidate.content.parts || [];

    const textPart = parts.find((p) => p.text)?.text?.trim() || null;
    const funcParts = parts.filter((p) => p.functionCall);

    contents.push({ role: 'model', parts: candidate.content.parts });

    if (funcParts.length === 0) {
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

    const userParts = [];

    for (let i = 0; i < funcParts.length; i++) {
      const funcPart = funcParts[i];
      const { name: toolName, args } = funcPart.functionCall;
      const thought = (i === 0 && textPart) ? textPart : `Calling ${toolName}`;

      console.log(
        `[Agent] Step ${stepNum}.${i+1}: ${toolName} — ${thought.substring(0, 80)}${thought.length > 80 ? '...' : ''}`
      );

      const result = await dispatch(toolName, args, emailId, email.urgency, dryRun, steps);

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

      userParts.push({
        functionResponse: {
          name: toolName,
          response: { result: result.observation },
        },
      });
    }

    contents.push({
      role: 'user',
      parts: userParts,
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
        false,
        steps
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

  // Programmatic fallback safeguard: If the model finished naturally (resolvedCleanly === true)
  // but did not take any terminal action (finalActionType remains 'Ignored') even though
  // the email requires human attention or is critical.
  // Exception: if the agent completed a GDPR auto-reply (Auto-Reply), do not force-escalate.
  if (resolvedCleanly && finalActionType === 'Ignored') {
    if (email.urgency === 'Critical' || email.requires_human) {
      const autoEscalateReason = `Auto-escalation fallback: Agent finished naturally without calling escalate_to_human despite 'Critical' urgency or 'Requires Human' flag being set.`;
      console.log(`[Agent] Programmatic fallback escalation triggered for ${email.message_id}`);

      if (!dryRun) {
        await dispatch(
          'escalate_to_human',
          { reason: autoEscalateReason, priority: email.urgency === 'Critical' ? 'Critical' : 'High' },
          emailId,
          email.urgency,
          false,
          steps
        );
      }

      steps.push({
        step: steps.length + 1,
        thought: 'Programmatic fallback escalation triggered. Urgency is Critical or Requires Human is true, but the agent finished without calling escalate_to_human.',
        action: 'escalate_to_human [FALLBACK]',
        args: { reason: autoEscalateReason, priority: email.urgency === 'Critical' ? 'Critical' : 'High' },
        observation: 'Auto-escalated via fallback safeguard. Human agent briefed.',
        timestamp: new Date().toISOString(),
      });
      finalActionType = 'Escalate';
    }
  }

  // reasoning log:
  // Single actions row per agent run that contains:
  //   - action_type  → the terminal action taken
  //   - agent_reasoning_log → full JSONB step array (the visible trace)
  //   - proposed_content → reply text (if send_auto_reply was called)
  if (!dryRun) {
    const logClient = await pool.connect();
    try {
      const isApproved = (finalActionType === 'Auto-Reply');
      await logClient.query(
        `INSERT INTO actions
           (email_id, thread_id, action_type, agent_reasoning_log, proposed_content, is_approved)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
        [
          emailId,
          email.thread_id,
          finalActionType,
          JSON.stringify(steps),
          proposedReply,
          isApproved,
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
