import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { reportCrash, installGlobalCrashReporting } from './services/crashReporter';
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

  // Phase 5: automatic crash reporting. Registered here (not in index.html's
  // inline script) because it needs the Supabase client from the ES module
  // bundle -- it covers everything from this point of the session onward.
  // The ErrorBoundary below additionally catches React render-time errors
  // specifically (with the component stack attached), which don't always
  // reach these window-level handlers.
  installGlobalCrashReporting();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );

  // Only reached if the calls above didn't throw synchronously. React's
  // own render errors (inside components) are caught separately below via
  // window.onerror/unhandledrejection, since render happens async.
  (window as any).__dsBootOk?.();
} catch (err: any) {
  console.error('DS Mobile: fatal startup error', err);
  // window.onerror in index.html already caught this for local *display*
  // (thrown errors bubble there too), but that inline script can't reach
  // Supabase (it runs before the module bundle loads) -- report it here too
  // now that we're back in module code, so a fatal boot crash actually
  // reaches the owner/developer, not just the device screen.
  void reportCrash(err?.message || String(err), err?.stack, 'boot');
}
