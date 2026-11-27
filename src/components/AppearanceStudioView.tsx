import { Sparkles } from "lucide-react";
import {useState} from "react";
import {applyRetailMotion,getRetailMotion,type RetailMotion} from "./RetailHero";

import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { Card, CardBody, CardHeader } from "@/ui/Card";
import { DENSITY_SCALE, TEXT_SCALE, ThemePicker, useAppearance } from "@/theme";

/**
 * Appearance Studio — the new "DS Nexus" design-system kit (10 themes,
 * density + text-size controls, and the shared Button/Card/Badge primitives)
 * added to the app.
 *
 * Theme choices apply globally via the root theme bridge. This wrapper previews
 * the shared design primitives with the same active palette.
 */
export default function AppearanceStudioView() {
  const themeId = useAppearance((s) => s.themeId);
  const mode = useAppearance((s) => s.mode);
  const density = useAppearance((s) => s.density);
  const textSize = useAppearance((s) => s.textSize);
  const [motion,setMotion]=useState<RetailMotion>(getRetailMotion);

  return (
    <div className="section">
      <div className="section-head">
        <h2>
          <Sparkles size={16} style={{ display: "inline", marginRight: 8, verticalAlign: -2 }} />
          Appearance Studio (New Design Kit)
        </h2>
      </div>
      <p className="hint">Personalize the app's themes, density, text and retail animation style. Your device preference is saved automatically.</p>
      <h3>3D effects & motion</h3>
      <div className="retail-motion-options">
        {([{id:"cinematic",label:"Cinematic 3D",description:"Floating graphics and staged cards"},{id:"balanced",label:"Balanced",description:"Smooth, lightweight interactions"},{id:"quiet",label:"Minimal motion",description:"Static graphics and fewer effects"}] as const).map(option=><button key={option.id} type="button" className={"btn "+(motion===option.id?"primary":"")} aria-pressed={motion===option.id} onClick={()=>{setMotion(option.id);applyRetailMotion(option.id);}}>{option.label}<span>{option.description}</span></button>)}
      </div>
      <p className="hint">System reduced-motion preferences override animation effects. The 3D graphics use CSS, not a heavy graphics engine.</p>

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
              <CardHeader title="Today's sales" subtitle="Illustrative preview · not live sales" />
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
