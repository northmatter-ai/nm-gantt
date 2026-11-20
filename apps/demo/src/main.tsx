import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@nm/gantt/gantt.css';
import '@nm/construction-views/views.css';
import './app.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
