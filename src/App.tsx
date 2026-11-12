import { useEffect, useState } from 'react';
import Resident from './Resident';
import OperatorDesk from './operator/OperatorDesk';
import { io } from 'socket.io-client';
import { api, syncReports } from './data';

export default function App() {
  const [route, setRoute] = useState(location.pathname === '/operator' ? 'operator' : 'resident');
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const sync = () => void syncReports();
    sync(); const timer = setInterval(sync, 5000);
    // Pull desk changes (acknowledgement, verification) the moment the server announces them;
    // the interval above remains the fallback when the live connection is down.
    const socket = io();
    socket.on('reports:changed', sync);
    window.addEventListener('online', sync);
    return () => { clearInterval(timer); socket.disconnect(); window.removeEventListener('online', sync); };
  }, []);
  useEffect(() => {
    let active = true;
    const offline = () => setConnected(false);
    const check = async () => {
      if (!navigator.onLine) { setConnected(false); return; }
      try { await api('/api/health'); if (active) setConnected(navigator.onLine); }
      catch { if (active) setConnected(false); }
    };
    window.addEventListener('offline', offline); window.addEventListener('online', check);
    void check(); const timer = setInterval(check, 5000);
    return () => { active = false; clearInterval(timer); window.removeEventListener('offline', offline); window.removeEventListener('online', check); };
  }, []);
  useEffect(() => { const pop = () => setRoute(location.pathname === '/operator' ? 'operator' : 'resident'); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  const navigate = (next: string) => { history.pushState({}, '', next === 'operator' ? '/operator' : '/'); setRoute(next); };
  if (route === 'resident') return <Resident connected={connected} openDesk={() => navigate('operator')} />;
  return <OperatorDesk connected={connected} onNavigate={navigate} />;
}
