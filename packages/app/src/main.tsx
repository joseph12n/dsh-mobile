import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { I18nProvider } from './i18n/index.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing the #root element in index.html');

if ('serviceWorker' in navigator) {
  globalThis.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
