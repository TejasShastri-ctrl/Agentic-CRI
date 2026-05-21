import { useState } from 'react';
import { analyticsService } from '../api/analytics';

function Alert({ type = 'error', children }) {
  const styles = {
    error: 'bg-red-50 border-red-200 text-red-700',
    success: 'bg-green-50 border-green-200 text-green-700',
    info: 'bg-blue-50 border-blue-200 text-blue-700',
  };
  return <div className={`p-3 rounded-lg border text-sm mb-4 ${styles[type]}`}>{children}</div>;
}

const TABS = ['Sentiment Trend', 'Category Breakdown', 'RAG Search', 'Reputation Cache'];

// ─── Sentiment Trend ─────────────────────────────────────────────────────────

function SentimentTrendTab() {
  const [sender, setSender] = useState('');
  const [days, setDays] = useState('30');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const fetch = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await analyticsService.getSentimentTrend(sender || undefined, parseInt(days));
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <p className="text-xs text-gray-400 mb-4">
        GET /analytics/sentiment-trend?sender=...&days=...
      </p>
      {error && <Alert type="error">{error}</Alert>}
      <form onSubmit={fetch} className="flex gap-2 mb-6 flex-wrap">
        <input
          value={sender}
          onChange={e => setSender(e.target.value)}
          placeholder="Sender email (optional — blank = global)"
          className="border rounded-lg px-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <input
          type="number"
          value={days}
          onChange={e => setDays(e.target.value)}
          min="1"
          className="border rounded-lg px-3 py-2 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Days"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Fetching...' : 'Fetch'}
        </button>
      </form>

      {data && (
        <div>
          <div className="text-xs text-gray-400 mb-2">
            Showing {data.data.length} rows · Sender: <strong>{data.sender}</strong> · Last {data.days} days
          </div>
          {data.data.length === 0 ? (
            <p className="text-gray-400 text-sm">No data found for this period.</p>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Sender</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Day</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Avg Sentiment</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Email Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((row, i) => (
                    <tr key={i} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-700">{row.sender}</td>
                      <td className="px-4 py-2 text-gray-600">{new Date(row.day).toLocaleDateString()}</td>
                      <td className="px-4 py-2">
                        <span className={`font-semibold ${parseFloat(row.avg_sentiment_score) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {row.avg_sentiment_score}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-600">{row.email_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Category Breakdown ───────────────────────────────────────────────────────

function CategoryBreakdownTab() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const fetch = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await analyticsService.getCategoryBreakdown(from || undefined, to || undefined);
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <p className="text-xs text-gray-400 mb-4">
        GET /analytics/category-breakdown?from=...&to=...
      </p>
      {error && <Alert type="error">{error}</Alert>}
      <form onSubmit={fetch} className="flex gap-2 mb-6 flex-wrap items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">From (optional)</label>
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To (optional)</label>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Fetching...' : 'Fetch'}
        </button>
      </form>

      {data && (
        <div>
          <div className="text-xs text-gray-400 mb-2">{data.data.length} categories</div>
          {data.data.length === 0 ? (
            <p className="text-gray-400 text-sm">No categorized emails found.</p>
          ) : (
            <div className="space-y-2">
              {data.data.map((row, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-36 text-sm font-medium text-gray-700 truncate">{row.category}</div>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div
                      className="bg-blue-500 h-4 rounded-full transition-all"
                      style={{ width: `${row.percentage}%` }}
                    />
                  </div>
                  <div className="text-sm text-gray-600 w-20 text-right">
                    {row.count} ({row.percentage}%)
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── RAG Search ───────────────────────────────────────────────────────────────

function RAGSearchTab() {
  const [query, setQuery] = useState('refund policy');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const search = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await analyticsService.searchRAG(query.trim());
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <p className="text-xs text-gray-400 mb-4">
        GET /analytics/rag/search?q=... — searches the knowledge base via vector similarity
      </p>
      {error && <Alert type="error">{error}</Alert>}
      <form onSubmit={search} className="flex gap-2 mb-6">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search query..."
          className="border rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Searching...' : 'Search KB'}
        </button>
      </form>

      {data && (
        <div className="space-y-4">
          <div className="text-xs text-gray-400">Query: <strong>"{data.query}"</strong> — {data.results.length} results</div>
          {data.results.map((r, i) => (
            <div key={i} className="border rounded-lg p-4 bg-white">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-gray-500">
                  {r.source_doc} · chunk #{r.chunk_index}
                </div>
                <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                  similarity: {r.similarity}
                </span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{r.chunk_text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Reputation Cache ─────────────────────────────────────────────────────────

function ReputationTab() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const fetch = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await analyticsService.getReputation();
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <p className="text-xs text-gray-400 mb-4">
        GET /analytics/intelligence/reputation — web intelligence cache
      </p>
      {error && <Alert type="error">{error}</Alert>}
      <button
        onClick={fetch}
        disabled={loading}
        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 mb-6"
      >
        {loading ? 'Loading...' : 'Fetch Reputation Cache'}
      </button>

      {data && (
        <div>
          <div className="text-xs text-gray-400 mb-3">
            Source: <strong>{data.source}</strong> · {data.data.length} entries
          </div>
          {data.data.length === 0 ? (
            <p className="text-gray-400 text-sm">No reputation cache entries found.</p>
          ) : (
            <div className="space-y-3">
              {data.data.map((entry, i) => (
                <div key={i} className="border rounded-lg p-4 bg-white text-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-gray-800">{entry.target_entity}</div>
                    {entry.is_stub && (
                      <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded font-semibold">STUB</span>
                    )}
                  </div>
                  {entry.source_url && (
                    <div className="text-xs text-blue-600 mb-2">{entry.source_url}</div>
                  )}
                  <pre className="bg-gray-50 text-xs p-2 rounded overflow-auto max-h-40 text-gray-600">
                    {JSON.stringify(entry.scraped_data, null, 2)}
                  </pre>
                  <div className="text-xs text-gray-400 mt-2">
                    Scraped: {entry.scraped_at ? new Date(entry.scraped_at).toLocaleString() : '—'} ·
                    Expires: {entry.expires_at ? new Date(entry.expires_at).toLocaleString() : '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState(0);

  const tabContent = [
    <SentimentTrendTab key="sentiment" />,
    <CategoryBreakdownTab key="category" />,
    <RAGSearchTab key="rag" />,
    <ReputationTab key="reputation" />,
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
        <p className="text-gray-500 mt-1">Sentiment trends, category breakdown, RAG knowledge base search, and reputation cache.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b mb-6">
        {TABS.map((tab, i) => (
          <button
            key={tab}
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === i
                ? 'bg-white border border-b-white border-gray-200 text-blue-600 -mb-px'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="bg-white border rounded-xl shadow-sm p-6">
        {tabContent[activeTab]}
      </div>
    </div>
  );
}
