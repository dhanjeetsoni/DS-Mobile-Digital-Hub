import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
// "DS Nexus" design-system kit (ui/, theme/, styles/ at the project root).
// Part 1: this is no longer scoped to Appearance Studio only — it now
// drives the whole app's colours. bridge.css maps the app's existing CSS
// variable names onto these theme tokens so every screen (not just the
// Appearance Studio page) repaints when the theme changes.
import '../styles/index.css';
import './theme-bridge.css';
import './fx.css';
import { startAppearanceSync } from '../theme';

// Owns html[data-theme] / html[data-mode] for the entire app from now on.
// Must run before the first paint so there's no flash of the old palette.
startAppearanceSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
