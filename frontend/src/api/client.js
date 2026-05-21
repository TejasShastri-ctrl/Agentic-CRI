/**
 * Simple API wrapper to handle JSON responses and error extraction consistently.
 * Uses relative paths so Vite proxies them correctly.
 */
export async function apiClient(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || `HTTP ${response.status}`);
    error.code = data.error_code || 'UNKNOWN_ERROR';
    error.details = data.details || null;
    throw error;
  }

  return data;
}
