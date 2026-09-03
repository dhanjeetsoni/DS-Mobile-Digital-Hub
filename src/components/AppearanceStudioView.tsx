import { Sparkles } from "lucide-react";

import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { Card, CardBody, CardHeader } from "@/ui/Card";
import { DENSITY_SCALE, TEXT_SCALE, ThemePicker, useAppearance } from "@/theme";

/**
 * Appearance Studio — the new "DS Nexus" design-system kit (10 themes,
 * density + text-size controls, and the shared Button/Card/Badge primitives)
 * added to the app.
 *
 * It is intentionally self-contained: everything below lives inside a single
 * `.ds-scope` wrapper carrying its own `data-theme` / `data-mode` pair and
 * its own density/text CSS variables, so switching themes here can never
 * affect the look of any other screen in the app (which keeps running its
 * own, separate 22-theme system exactly as before via the sidebar's
 * existing "Theme" dropdown).
 */
export default function AppearanceStudioView() {
  const themeId = useAppearance((s) => s.themeId);
  const mode = useAppearance((s) => s.mode);
  const density = useAppearance((s) => s.density);
  const textSize = useAppearance((s) => s.textSize);

  return (
    <div className="section">
      <div className="section-head">
        <h2>
          <Sparkles size={16} style={{ display: "inline", marginRight: 8, verticalAlign: -2 }} />
          Appearance Studio (New Design Kit)
        </h2>
      </div>
      <p className="hint" style={{ marginBottom: 16 }}>
        Ye ek naya, alag design system hai (10 themes, light/dark, density &amp; text-size
        control) jo is update mein add kiya gaya hai. Ye poori tarah is card ke andar hi kaam
        karta hai — baaki poori app (aur sidebar ka purana "Theme" dropdown) bilkul pehle jaisa
        hi rahega, iska usse koi lena-dena nahi.
      </p>

      <div
        className="ds-scope"
        data-theme={themeId}
        data-mode={mode}
        style={{
          ["--density" as string]: DENSITY_SCALE[density],
          ["--text-scale" as string]: TEXT_SCALE[textSize],
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--line)",
          padding: "var(--pad)",
        }}
      >
        <ThemePicker />

        <div
          style={{
            marginTop: "var(--gap)",
            paddingTop: "var(--gap)",
            borderTop: "1px solid var(--line)",
          }}
        >
          <p
            style={{
              margin: "0 0 var(--gap)",
              fontSize: "0.8125rem",
              fontWeight: 600,
              color: "var(--ink-muted)",
            }}
          >
            Component preview
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--gap)", alignItems: "center" }}>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="danger">Danger</Button>
            <Badge tone="brand">Brand</Badge>
            <Badge tone="ok" dot>
              Paid
            </Badge>
            <Badge tone="warn" dot>
              Low stock
            </Badge>
            <Badge tone="danger" dot>
              Due
            </Badge>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "var(--gap)",
              marginTop: "var(--gap)",
            }}
          >
            <Card>
              <CardHeader title="Today's sales" subtitle="Live preview card" />
              <CardBody>
                <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>₹ 12,480</p>
                <p style={{ margin: "4px 0 0", fontSize: "0.8125rem", color: "var(--ink-muted)" }}>
                  8 bills · 3 pending dues
                </p>
              </CardBody>
            </Card>
            <Card selected>
              <CardHeader title="Selected state" subtitle="border-brand + glow" />
              <CardBody>
                <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--ink-muted)" }}>
                  Used for the active theme card and picked items.
                </p>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
