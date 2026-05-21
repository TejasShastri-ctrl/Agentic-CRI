import { NavLink } from 'react-router-dom';

const NAV_LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/threads', label: 'Threads' },
  { to: '/contacts', label: 'Contacts' },
  { to: '/ingest', label: 'Ingest' },
  { to: '/analytics', label: 'Analytics' },
];

export default function Navbar() {
  return (
    <nav className="bg-white border-b shadow-sm px-4 py-3">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <NavLink to="/" className="text-lg font-bold text-gray-900 tracking-tight">
          🤖 Agentic CRM
        </NavLink>
        <div className="flex gap-1">
          {NAV_LINKS.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}
