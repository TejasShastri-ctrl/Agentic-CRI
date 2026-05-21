// Routes tool names from the LLM to their implementations.

import { TOOLS } from './tools.js';

const BLOCKED_FOR_CRITICAL = new Set(['send_auto_reply']);

/**
 * Dispatch a tool call from the ReAct loop.
 *
 * @param {string} toolName    - Tool name from LLM output
 * @param {object} args        - Arguments parsed from LLM output
 * @param {string} emailId     - UUID of the email being processed (injected for tools that need it)
 * @param {string} urgency     - Urgency level of the email (Critical | High | Medium | Low)
 * @param {boolean} dryRun     - If true, return a dry-run placeholder instead of executing
 * @returns {{ ok: boolean, observation: string }}
 */
export async function dispatch(toolName, args, emailId, urgency, dryRun = false) {
  const tool = TOOLS[toolName];

  if (!tool) {
    const available = Object.keys(TOOLS).join(', ');
    return {
      ok: false,
      observation: `Unknown tool: "${toolName}". Available tools: ${available}.`,
    };
  }

  // hard gate, not delegating the trust and unnecessary compute to LLM
  if (urgency === 'Critical' && BLOCKED_FOR_CRITICAL.has(toolName)) {
    return {
      ok: false,
      observation: `[DISPATCHER BLOCKED] send_auto_reply is not permitted for Critical urgency emails. This call was rejected by the dispatcher, not the LLM. Use escalate_to_human instead.`,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      observation: `[DRY-RUN] Would execute: ${toolName}(${JSON.stringify(args)})`,
    };
  }

  // Inject emailId for tools that need it. the LLM doesn't need to know the UUID
  const enrichedArgs = tool.needsEmailId ? { ...args, email_id: emailId } : args;

  try {
    const result = await tool.fn(enrichedArgs);
    return {
      ok: true,
      observation: String(result).substring(0, 1500), // cap observation to avoid runaway context
    };
  } catch (err) {
    console.error(`[Dispatcher] Tool error (${toolName}):`, err);
    return {
      ok: false,
      observation: `Tool error in ${toolName}: ${err.message}`,
    };
  }
}
