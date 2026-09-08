import React from "react";
import { reportCrash } from "../services/crashReporter";

interface Props {
  children: React.ReactNode;
}
interface State {
  hasError: boolean;
}

// Phase 5: part of automatic crash reporting. window.onerror/
// unhandledrejection (see crashReporter.ts's installGlobalCrashReporting)
// catch most runtime errors, but a React error boundary is the only way to
// catch an error thrown *during render* with the actual component stack
// attached, and — just as importantly — to show a recoverable "something
// broke, tap to reload" screen instead of leaving a blank white page once
// a component throws, which is exactly the kind of silent failure this
// project spent a long time chasing without any error being visible at all.
//
// Note: this repo's installed React 19 package ships no .d.ts files at all
// (no @types/react dependency either), so tsc doesn't reliably infer
// React.Component's own inherited `props`/`state` members here. The `any`
// casts below are purely to work around that type-resolution quirk in
// *this* environment — behaviour at runtime is the same as a normal error
// boundary.
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    (this as any).state = { hasError: false } as State;
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, info: any) {
    void reportCrash(error?.message, error?.stack, "runtime", {
      componentStack: info?.componentStack?.slice(0, 4000),
    });
  }

  render(): any {
    const state: State = (this as any).state;
    if (state.hasError) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          textAlign: "center",
          background: "#0b0f14",
          color: "#f5f5f5",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>Kuch gadbad ho gayi</h1>
          <p style={{ fontSize: 14, color: "#cbd5e1", maxWidth: 360, margin: 0 }}>
            App mein ek unexpected error aa gaya. Ye automatically report ho chuka hai — aap bas neeche dobara try karein.
          </p>
          <button
            onClick={() => location.reload()}
            style={{ padding: "10px 18px", fontSize: 14, borderRadius: 8, border: "none", background: "#2563eb", color: "white", cursor: "pointer" }}
          >
            Dobara try karein
          </button>
        </div>
      );
    }
    return (this as any).props.children;
  }
}
