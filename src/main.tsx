import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
// New "DS Nexus" design-system kit (ui/, theme/, styles/ at the project
// root) — scoped entirely under `.ds-scope` so it adds new capability
// without touching any existing screen's look or behaviour.
import '../styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
