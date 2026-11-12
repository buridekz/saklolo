/// <reference types="vite-plugin-pwa/client" />
import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';
import './update.css';

export default function AppUpdate() {
  const { needRefresh: [ready, setReady], updateServiceWorker } = useRegisterSW({ immediate: true });
  useEffect(() => {
    const check = () => {
      if (navigator.onLine && 'serviceWorker' in navigator) {
        void navigator.serviceWorker.getRegistration().then(registration => registration?.update()).catch(() => {});
      }
    };
    window.addEventListener('focus', check); window.addEventListener('online', check);
    check();
    return () => { window.removeEventListener('focus', check); window.removeEventListener('online', check); };
  }, []);
  if (!ready) return null;
  return <aside className="app-update" aria-label="App update" role="status"><RefreshCw size={20} /><div><strong>An update is ready</strong><p>Save any edits and finish your voice session before reloading.</p><div className="app-update-actions"><Button onClick={() => void updateServiceWorker(true)}>Reload app</Button><Button variant="ghost" onClick={() => setReady(false)}>Later</Button></div></div></aside>;
}
