import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@northmatter-ai/gantt/gantt.css';
import '@northmatter-ai/construction-views/views.css';
import './app.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
