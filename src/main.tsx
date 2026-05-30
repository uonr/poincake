import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './app/App';

const root = document.querySelector('#root');
if (!root) {
  throw new Error('Missing required element: #root');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
