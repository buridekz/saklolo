import { useEffect, useState } from 'react';
import Resident from './Resident';
import OperatorDesk from './operator/OperatorDesk';
import { api, syncReports } from './data';

export default function App() {
  const [route, setRoute] = useState(location.pathname === '/operator' ? 'operator' : 'resident');
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const sync = () => void syncReports();
    sync(); const timer = setInterval(sync, 5000);
    window.addEventListener('online', sync);
    return () => { clearInterval(timer); window.removeEventListener('online', sync); };
  }, []);
  useEffect(() => {
    const check = async () => { try { await api('/api/health'); setConnected(true); } catch { setConnected(false); } };
    void check(); const timer = setInterval(check, 5000); return () => clearInterval(timer);
  }, []);
  useEffect(() => { const pop = () => setRoute(location.pathname === '/operator' ? 'operator' : 'resident'); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  const navigate = (next: string) => { history.pushState({}, '', next === 'operator' ? '/operator' : '/'); setRoute(next); };
  if (route === 'resident') return <Resident connected={connected} openDesk={() => navigate('operator')} />;
  return <OperatorDesk connected={connected} onNavigate={navigate} />;
}
