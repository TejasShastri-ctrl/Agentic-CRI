import { useState } from 'react';
import { dashboardService } from '../api/dashboard';
import { actionsService } from '../api/actions';
import { ingestService } from '../api/ingest';

// ─── small shared helpers ────────────────────────────────────────────────────

function Badge({ children, color = 'gray' }) {
  const colorMap = {
    gray: 'bg-gray-100 text-gray-700',
    blue: 'bg-blue-100 text-blue-800',
    purple: 'bg-purple-100 text-purple-800',
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    yellow: 'bg-yellow-100 text-yellow-800',
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${colorMap[color] || colorMap.gray}`}>
      {children}
    </span>
  );
}

function Alert({ type = 'error', children }) {
  const styles = {
    error: 'bg-red-50 border-red-200 text-red-700',
    success: 'bg-green-50 border-green-200 text-green-700',
    info: 'bg-blue-50 border-blue-200 text-blue-700',
  };
  return (
    <div className={`p-3 rounded-lg border text-sm mb-4 ${styles[type]}`}>
      {children}
    </div>
  );
}

// ─── Reply form ──────────────────────────────────────────────────────────────

function ReplyForm({ emailId, onSuccess }) {
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await actionsService.sendReply(emailId, body);
      setResult(data);
      setBody('');
      onSuccess?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-4 bg-white border rounded-lg p-4">
      <div className="text-sm font-semibold text-gray-700 mb-2">Send Human Reply</div>
      {result && <Alert type="success">✓ Reply sent. Action ID: {result.action_id}</Alert>}
      {error && <Alert type="error">{error}</Alert>}
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={3}
        required
        placeholder="Type your reply..."
        className="w-full border rounded p-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <button
        type="submit"
        disabled={loading}
        className="mt-2 bg-blue-600 text-white text-sm px-4 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Sending...' : 'Send Reply'}
      </button>
    </form>
  );
}

// ─── Draft action card ───────────────────────────────────────────────────────

function DraftCard({ action, onRefresh }) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(action.proposed_content || '');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  const saveEdit = async () => {
    setLoading(true);
    setError(null);
    try {
      await actionsService.editDraft(action.id, editContent);
      setMsg('Draft updated.');
      setEditing(false);
      onRefresh?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const approve = async () => {
    setLoading(true);
    setError(null);
    try {
      await actionsService.approveDraft(action.id);
      setMsg('Draft approved and sent!');
      onRefresh?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const reasoningLog = () => {
    if (!action.agent_reasoning_log) return null;
    try {
      const parsed = typeof action.agent_reasoning_log === 'string'
        ? JSON.parse(action.agent_reasoning_log)
        : action.agent_reasoning_log;
      return JSON.stringify(parsed, null, 2);
    } catch {
      return String(action.agent_reasoning_log);
    }
  };

  return (
    <div className="bg-white border rounded-lg p-4 text-sm shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-bold text-gray-700 uppercase tracking-wide">{action.action_type}</span>
        {action.is_approved
          ? <Badge color="green">Approved</Badge>
          : <Badge color="yellow">Draft</Badge>}
        <span className="text-xs text-gray-400 ml-auto">ID: {action.id}</span>
      </div>

      {msg && <Alert type="success">{msg}</Alert>}
      {error && <Alert type="error">{error}</Alert>}

      {action.proposed_content && (
        editing ? (
          <div>
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              rows={4}
              className="w-full border rounded p-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={saveEdit} disabled={loading} className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50">
                {loading ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)} className="bg-gray-100 text-gray-700 text-xs px-3 py-1.5 rounded hover:bg-gray-200">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-slate-50 border rounded p-3 text-slate-700 whitespace-pre-wrap mb-3">
            {editContent}
          </div>
        )
      )}

      {!action.is_approved && (
        <div className="flex gap-2 mt-2">
          {action.proposed_content && !editing && (
            <button onClick={() => setEditing(true)} className="bg-gray-100 text-gray-700 text-xs px-3 py-1.5 rounded hover:bg-gray-200">
              Edit Draft
            </button>
          )}
          <button onClick={approve} disabled={loading} className="bg-green-600 text-white text-xs px-3 py-1.5 rounded hover:bg-green-700 disabled:opacity-50">
            {loading ? 'Approving...' : 'Approve & Send'}
          </button>
        </div>
      )}

      {action.agent_reasoning_log && (
        <details className="mt-3">
          <summary className="cursor-pointer text-blue-600 text-xs font-medium hover:underline">
            View Agent Thought Process
          </summary>
          <pre className="mt-2 p-3 bg-gray-900 text-green-400 rounded text-xs overflow-auto font-mono leading-relaxed max-h-64">
            {reasoningLog()}
          </pre>
        </details>
      )}
    </div>
  );
}

// ─── Per-email dry-run ────────────────────────────────────────────────────────

function DryRunPanel({ emailId }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await ingestService.agentDryRun(emailId);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-3">
      <button
        onClick={run}
        disabled={loading}
        className="bg-slate-700 text-white text-xs px-3 py-1.5 rounded hover:bg-slate-800 disabled:opacity-50"
      >
        {loading ? 'Running dry-run...' : '🤖 Agent Dry-Run'}
      </button>
      {error && <Alert type="error">{error}</Alert>}
      {result && (
        <div className="mt-3 bg-slate-50 border rounded p-4 text-sm">
          <div className="font-semibold text-slate-700 mb-2">
            Dry-Run Complete — Projected: <Badge color="blue">{result.projected_action}</Badge>
            <span className="text-gray-400 text-xs ml-2">({result.step_count} steps)</span>
          </div>
          <pre className="bg-gray-900 text-green-400 text-xs p-3 rounded overflow-auto max-h-72 font-mono">
            {JSON.stringify(result.steps, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ThreadView() {
  const [emailQuery, setEmailQuery] = useState('karen.w@retail-co.com');
  const [threadsData, setThreadsData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const searchThreads = async (e) => {
    e?.preventDefault();
    if (!emailQuery.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await dashboardService.getThreads(emailQuery.trim());
      setThreadsData(data);
    } catch (err) {
      setError(err.message);
      setThreadsData(null);
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => searchThreads();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Thread Workspace</h1>
        <p className="text-gray-500 mt-1">Look up threads by sender email. Send replies, edit and approve agent drafts, run dry-runs.</p>
      </div>

      <form onSubmit={searchThreads} className="flex gap-2 mb-8">
        <input
          type="email"
          value={emailQuery}
          onChange={e => setEmailQuery(e.target.value)}
          className="border rounded-lg px-3 py-2 w-96 shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Enter contact email..."
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg shadow-sm hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
        >
          {loading ? 'Searching...' : 'Lookup Thread'}
        </button>
      </form>

      {error && <Alert type="error">{error}</Alert>}

      {threadsData && (
        <div className="space-y-8">
          <div className="text-sm text-gray-500">
            Found <strong>{threadsData.threads.length}</strong> thread(s) for <strong>{threadsData.contact_email}</strong>
          </div>

          {threadsData.threads.map(thread => (
            <div key={thread.id} className="bg-white border rounded-xl shadow-sm overflow-hidden">
              {/* Thread header */}
              <div className="px-6 py-4 bg-gray-50 border-b flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-lg text-gray-900">{thread.subject}</h3>
                  <div className="text-xs text-gray-400 mt-0.5">
                    Thread ID: {thread.thread_id} · Last updated: {new Date(thread.last_updated_at).toLocaleString()}
                  </div>
                </div>
                <Badge color={thread.status === 'Resolved' ? 'green' : thread.status === 'Escalated' ? 'red' : 'blue'}>
                  {thread.status}
                </Badge>
              </div>

              <div className="p-6 space-y-4">
                {/* Emails */}
                {thread.emails.map(email => (
                  <div key={email.id} className="border rounded-lg p-4 bg-white">
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-3 border-b pb-3 flex-wrap gap-2">
                      <span className="font-medium text-gray-600">{new Date(email.timestamp).toLocaleString()}</span>
                      <div className="flex gap-1.5 flex-wrap">
                        {email.status && <Badge color="gray">{email.status}</Badge>}
                        {email.category && <Badge color="purple">{email.category}</Badge>}
                        {email.sentiment && (
                          <Badge color={email.sentiment === 'Positive' ? 'green' : email.sentiment === 'Negative' ? 'red' : 'gray'}>
                            {email.sentiment} ({email.sentiment_score})
                          </Badge>
                        )}
                        {email.urgency && (
                          <Badge color={email.urgency === 'Critical' ? 'red' : email.urgency === 'High' ? 'yellow' : 'gray'}>
                            {email.urgency}
                          </Badge>
                        )}
                        {email.is_spam && <Badge color="gray">SPAM</Badge>}
                      </div>
                    </div>

                    <p className="whitespace-pre-wrap text-gray-800 text-sm leading-relaxed">{email.body}</p>

                    {email.requires_human && (
                      <div className="mt-3 text-sm text-red-700 bg-red-50 p-3 rounded border border-red-200">
                        <strong>Escalation:</strong> {email.escalation_reason}
                      </div>
                    )}

                    <div className="mt-3 border-t pt-3 flex gap-3 flex-wrap text-xs text-gray-400">
                      <span>Email ID: <code className="bg-gray-100 px-1 rounded">{email.id}</code></span>
                    </div>

                    {/* Dry-run launcher */}
                    {!email.is_spam && <DryRunPanel emailId={email.id} />}

                    {/* Reply form — only show for non-replied emails */}
                    {email.status !== 'Replied' && email.status !== 'Ignored' && (
                      <ReplyForm emailId={email.id} onSuccess={refresh} />
                    )}
                  </div>
                ))}

                {/* Agent actions / drafts */}
                {thread.actions && thread.actions.length > 0 && (
                  <div className="mt-4">
                    <h5 className="font-semibold text-gray-700 text-sm mb-3">Agent Actions & Drafts</h5>
                    <div className="space-y-3">
                      {thread.actions.map(action => (
                        <DraftCard key={action.id} action={action} onRefresh={refresh} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
