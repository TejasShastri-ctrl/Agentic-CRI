import { useState } from 'react';
import { ingestService } from '../api/ingest';

function generateMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateTimestamp() {
  return new Date().toISOString();
}

function Alert({ type = 'error', children }) {
  const styles = {
    error: 'bg-red-50 border-red-200 text-red-700',
    success: 'bg-green-50 border-green-200 text-green-700',
    info: 'bg-blue-50 border-blue-200 text-blue-700',
  };
  return <div className={`p-3 rounded-lg border text-sm mb-4 ${styles[type]}`}>{children}</div>;
}

// ─── Ingest Form ─────────────────────────────────────────────────────────────

function IngestForm() {
  const [form, setForm] = useState({
    message_id: generateMessageId(),
    sender: 'karen.w@retail-co.com',
    subject: 'Issue with my order',
    body: 'Hi, I have been waiting 2 weeks for my shipment and have heard nothing. This is unacceptable.',
    timestamp: generateTimestamp(),
    thread_id: `thread-${Date.now()}`,
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await ingestService.ingestEmail(form);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const regenerate = () => {
    setForm(prev => ({
      ...prev,
      message_id: generateMessageId(),
      timestamp: generateTimestamp(),
    }));
  };

  const labelClass = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1';
  const inputClass = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';

  return (
    <div className="bg-white border rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-800">Ingest Email — POST /api/ingest</h2>
        <button
          type="button"
          onClick={regenerate}
          className="text-xs text-blue-600 hover:underline"
        >
          Regenerate IDs & Timestamp
        </button>
      </div>

      {result && (
        <Alert type="success">
          <div className="font-semibold mb-1">✓ Ingested successfully</div>
          <div className="space-y-0.5 font-mono text-xs">
            <div>email_id: <strong>{result.email_id}</strong></div>
            <div>job_id: <strong>{result.job_id || 'null (spam/internal/security flagged)'}</strong></div>
            {result.deduplicated && <div className="text-yellow-700">⚠ Duplicate — already processed</div>}
            {result.pre_filter && (
              <div className="mt-2 bg-white border rounded p-2">
                <div className="font-semibold mb-1">Pre-filter result:</div>
                <pre className="text-xs overflow-auto">{JSON.stringify(result.pre_filter, null, 2)}</pre>
              </div>
            )}
          </div>
        </Alert>
      )}
      {error && <Alert type="error">{error}</Alert>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>message_id</label>
            <input className={inputClass} value={form.message_id} onChange={set('message_id')} required />
          </div>
          <div>
            <label className={labelClass}>thread_id</label>
            <input className={inputClass} value={form.thread_id} onChange={set('thread_id')} required />
          </div>
          <div>
            <label className={labelClass}>sender (email)</label>
            <input type="email" className={inputClass} value={form.sender} onChange={set('sender')} required />
          </div>
          <div>
            <label className={labelClass}>timestamp (ISO 8601)</label>
            <input className={inputClass} value={form.timestamp} onChange={set('timestamp')} required />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>subject</label>
            <input className={inputClass} value={form.subject} onChange={set('subject')} required />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>body</label>
            <textarea
              className={inputClass}
              rows={5}
              value={form.body}
              onChange={set('body')}
              required
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Ingesting...' : 'Submit Email'}
        </button>
      </form>
    </div>
  );
}

// ─── Job Status Poller ────────────────────────────────────────────────────────

function JobStatusPoller() {
  const [jobId, setJobId] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const poll = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await ingestService.checkJobStatus(jobId.trim());
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border rounded-xl shadow-sm p-6">
      <h2 className="font-semibold text-gray-800 mb-4">Job Status — GET /api/status/:jobId</h2>
      {error && <Alert type="error">{error}</Alert>}
      {result && (
        <Alert type="success">
          <pre className="text-xs font-mono overflow-auto">{JSON.stringify(result, null, 2)}</pre>
        </Alert>
      )}
      <form onSubmit={poll} className="flex gap-2">
        <input
          value={jobId}
          onChange={e => setJobId(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Enter job ID (UUID)..."
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? 'Checking...' : 'Poll Status'}
        </button>
      </form>
    </div>
  );
}

// ─── Agent Dry-Run by Email ID ────────────────────────────────────────────────

function AgentDryRunPanel() {
  const [emailId, setEmailId] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const run = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await ingestService.agentDryRun(emailId.trim());
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border rounded-xl shadow-sm p-6">
      <h2 className="font-semibold text-gray-800 mb-1">Agent Dry-Run — POST /api/agent/dry-run/:emailId</h2>
      <p className="text-xs text-gray-400 mb-4">
        Runs the full ReAct loop in planning mode. No tools are actually executed. Returns the complete reasoning trace.
      </p>
      {error && <Alert type="error">{error}</Alert>}
      <form onSubmit={run} className="flex gap-2 mb-4">
        <input
          value={emailId}
          onChange={e => setEmailId(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Enter email ID (integer)..."
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? 'Running...' : '🤖 Run Dry-Run'}
        </button>
      </form>

      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-semibold text-gray-700">Projected Action:</span>
            <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded">{result.projected_action}</span>
            <span className="text-gray-400">({result.step_count} steps)</span>
          </div>
          <pre className="bg-gray-900 text-green-400 text-xs p-4 rounded overflow-auto max-h-96 font-mono">
            {JSON.stringify(result.steps, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function IngestPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Email Ingest</h1>
        <p className="text-gray-500 mt-1">Submit emails into the pipeline, poll job status, and run agent dry-runs.</p>
      </div>
      <div className="space-y-6">
        <IngestForm />
        <JobStatusPoller />
        <AgentDryRunPanel />
      </div>
    </div>
  );
}
