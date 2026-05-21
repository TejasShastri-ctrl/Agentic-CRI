import { useState } from 'react';
import { contactsService } from '../api/contacts';

const STATUS_OPTIONS = ['VIP', 'Active', 'Churned', 'Blocked'];

const STATUS_COLORS = {
  VIP: 'bg-purple-100 text-purple-800',
  Active: 'bg-green-100 text-green-800',
  Churned: 'bg-gray-100 text-gray-600',
  Blocked: 'bg-red-100 text-red-800',
};

function Badge({ children, className = '' }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${className}`}>
      {children}
    </span>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-xs text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-medium text-gray-800 mt-0.5">{value ?? '—'}</div>
    </div>
  );
}

export default function ContactsPage() {
  const [email, setEmail] = useState('bob.jones@enterprise-co.com');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [newStatus, setNewStatus] = useState('');
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [statusError, setStatusError] = useState(null);

  const fetchContact = async (e) => {
    e?.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    setStatusMsg(null);
    try {
      const res = await contactsService.getContact(email.trim());
      setData(res);
      setNewStatus(res.contact.status || 'Active');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (e) => {
    e.preventDefault();
    setStatusLoading(true);
    setStatusMsg(null);
    setStatusError(null);
    try {
      const res = await contactsService.updateStatus(email.trim(), newStatus);
      setStatusMsg(`Status updated to ${res.contact.status}`);
      // Update local state immediately
      setData(prev => ({ ...prev, contact: { ...prev.contact, status: res.contact.status } }));
    } catch (err) {
      setStatusError(err.message);
    } finally {
      setStatusLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Contact Profiles</h1>
        <p className="text-gray-500 mt-1">Fetch full contact details, churn risk, billing, and update status.</p>
      </div>

      <form onSubmit={fetchContact} className="flex gap-2 mb-8">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="border rounded-lg px-3 py-2 w-96 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Contact email address..."
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Fetch Contact'}
        </button>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg text-sm mb-6">{error}</div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Contact profile card */}
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b flex items-center justify-between">
              <div>
                <h2 className="font-bold text-xl text-gray-900">{data.contact.name || data.contact.email}</h2>
                <div className="text-sm text-gray-500">{data.contact.email} · {data.contact.company || 'No company'}</div>
              </div>
              <Badge className={STATUS_COLORS[data.contact.status] || 'bg-gray-100 text-gray-600'}>
                {data.contact.status}
              </Badge>
            </div>

            <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-6">
              <Field label="Subscription Tier" value={data.contact.subscription_tier} />
              <Field label="Billing Status" value={data.contact.billing_status} />
              <Field label="Overdue Amount" value={data.contact.overdue_amount != null ? `$${data.contact.overdue_amount}` : null} />
              <Field label="Account Value" value={data.contact.account_value != null ? `$${data.contact.account_value}` : null} />
              <Field label="Churn Risk Score" value={data.contact.churn_risk_score != null ? `${(data.contact.churn_risk_score * 100).toFixed(0)}%` : null} />
              <Field label="Last Contact" value={data.contact.last_contact_at ? new Date(data.contact.last_contact_at).toLocaleDateString() : null} />
              <Field label="Created At" value={data.contact.created_at ? new Date(data.contact.created_at).toLocaleDateString() : null} />
            </div>
          </div>

          {/* Update status */}
          <div className="bg-white border rounded-xl shadow-sm p-6">
            <h3 className="font-semibold text-gray-800 mb-4">Update Contact Status</h3>
            {statusMsg && <div className="bg-green-50 border border-green-200 text-green-700 p-3 rounded text-sm mb-3">{statusMsg}</div>}
            {statusError && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm mb-3">{statusError}</div>}
            <form onSubmit={updateStatus} className="flex gap-3 items-center">
              <select
                value={newStatus}
                onChange={e => setNewStatus(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={statusLoading}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {statusLoading ? 'Updating...' : 'Update Status'}
              </button>
            </form>
          </div>

          {/* Threads summary */}
          {data.threads && data.threads.length > 0 && (
            <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-gray-50 border-b font-semibold text-gray-700">
                Threads ({data.threads.length})
              </div>
              <div className="divide-y">
                {data.threads.map(thread => (
                  <div key={thread.thread_id} className="px-6 py-3 flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium text-gray-800">{thread.subject}</div>
                      <div className="text-xs text-gray-400">
                        Thread ID: {thread.thread_id} · {thread.email_count} email(s)
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={STATUS_COLORS[thread.status] || 'bg-gray-100 text-gray-600'}>{thread.status}</Badge>
                      <span className="text-xs text-gray-400">{new Date(thread.last_updated_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
