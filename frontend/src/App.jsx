import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import ThreadView from './pages/ThreadView';
import ContactsPage from './pages/ContactsPage';
import IngestPage from './pages/IngestPage';
import AnalyticsPage from './pages/AnalyticsPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="threads" element={<ThreadView />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="ingest" element={<IngestPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;

