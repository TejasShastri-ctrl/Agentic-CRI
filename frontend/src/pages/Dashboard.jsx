import { useState, useEffect } from 'react';
import { dashboardService } from '../api/dashboard';
import { Link } from 'react-router-dom';

const STAT_LABELS = {
  pending: 'Pending',
  replied: 'Replied',
  escalated: 'Escalated',
  critical: 'Critical',
  spam: 'Spam',
  total: 'Total',
};

const STAT_COLORS = {
  pending: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  replied: 'bg-green-50 border-green-200 text-green-700',
  escalated: 'bg-red-50 border-red-200 text-red-700',
  critical: 'bg-red-100 border-red-300 text-red-800',
  spam: 'bg-gray-50 border-gray-200 text-gray-600',
  total: 'bg-blue-50 border-blue-200 text-blue-700',
};

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardService.getStats()
      .then(data => setStats(data.stats))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Mission Control</h1>
        <p className="text-gray-500 mt-1">Live inbox overview from the database.</p>
      </div>

      {error && (
        <div className="text-red-700 mb-6 bg-red-50 p-4 rounded-lg border border-red-200">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading && <p className="text-gray-400">Loading stats...</p>}

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-10">
          {Object.entries(stats).map(([key, value]) => (
            <div
              key={key}
              className={`p-4 rounded-lg border text-center ${STAT_COLORS[key] || 'bg-white border-gray-200'}`}
            >
              <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
                {STAT_LABELS[key] || key}
              </div>
              <div className="text-3xl font-bold mt-2">{value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        {[
          { to: '/threads', label: 'Thread Workspace', desc: 'Look up threads by contact email, view agent reasoning & send replies.' },
          { to: '/contacts', label: 'Contact Profiles', desc: 'Fetch contact details, churn risk, billing status, and update VIP status.' },
          { to: '/ingest', label: 'Ingest Email', desc: 'POST a new email into the pipeline. Poll job status. Trigger agent dry-run.' },
          { to: '/analytics', label: 'Analytics', desc: 'Sentiment trends, category breakdown, RAG search, reputation cache.' },
        ].map(({ to, label, desc }) => (
          <Link
            key={to}
            to={to}
            className="block p-5 rounded-lg border border-gray-200 bg-white hover:border-blue-400 hover:shadow-md transition-all"
          >
            <div className="font-semibold text-gray-800 mb-1">{label} →</div>
            <div className="text-sm text-gray-500">{desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
