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

// Everything below used to run unguarded: if startAppearanceSync() or the
// very first render threw for ANY reason (bad persisted localStorage
// payload, an API missing on an older Android WebView, etc), nothing ever
// reached the screen — just the dark theme's background colour with no
// content and no error, indistinguishable from a hang. index.html's
// #boot-fallback overlay + window.__dsBootOk() (declared there) turn that
// into a visible, reportable error message instead.
try {
  // Owns html[data-theme] / html[data-mode] for the entire app from now on.
  // Must run before the first paint so there's no flash of the old palette.
  startAppearanceSync();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // Only reached if the calls above didn't throw synchronously. React's
  // own render errors (inside components) are caught separately below via
  // window.onerror/unhandledrejection, since render happens async.
  (window as any).__dsBootOk?.();
} catch (err) {
  console.error('DS Mobile: fatal startup error', err);
  // window.onerror in index.html already caught this (thrown errors bubble
  // there too), so no extra reporting needed here — just don't let it stay
  // a silent blank screen by rethrowing into the void.
}
