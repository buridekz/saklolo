import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import 'leaflet/dist/leaflet.css';
import './ui.css';
import './styles.css';
import App from './App';
import AppUpdate from './AppUpdate';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /><AppUpdate /></React.StrictMode>);
